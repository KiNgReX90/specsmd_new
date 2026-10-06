const fs = require('fs-extra');
const path = require('path');
const prompts = require('prompts');
const yaml = require('js-yaml');
const CLIUtils = require('./cli-utils');
const InstallerFactory = require('./InstallerFactory');
const { FLOWS, LINKS } = require('./constants');
const analytics = require('./analytics');
const { stageFlow } = require('./install/stage');
const { applyInstall, InstallError } = require('./install/transaction');
const { sourceCommit } = require('./install/lock');
const { hostConfigEdits } = require('./install/host-config');

// Use theme from CLIUtils for consistent styling
const { theme } = CLIUtils;

/**
 * Categorize an error for analytics tracking
 * @param {Error} error - The error to categorize
 * @returns {string} Error category
 */
function categorizeError(error) {
    const message = (error.message || '').toLowerCase();

    if (message.includes('permission') || message.includes('eacces')) {
        return 'file_permission';
    }
    if (message.includes('enoent') || message.includes('not found')) {
        return 'file_not_found';
    }
    if (message.includes('network') || message.includes('enotfound') || message.includes('timeout')) {
        return 'network';
    }
    if (message.includes('enospc') || message.includes('disk')) {
        return 'disk_space';
    }
    return 'unknown';
}

async function detectTools() {
  const detected = [];
  const installers = InstallerFactory.getInstallers();

  for (const installer of installers) {
    if (await installer.detect()) {
      detected.push(installer.key);
    }
  }
  return detected;
}

async function install() {
  // Initialize analytics (respects opt-out env vars)
  analytics.init();
  await analytics.trackInstallerStarted();

  const installStartTime = Date.now();

  await CLIUtils.displayLogo();
  CLIUtils.displayHeader('Installation', '');

  // Step 1: Detect agentic coding tools
  const detectedToolKeys = await detectTools();
  const installers = InstallerFactory.getInstallers();
  const detectedNames = installers
    .filter(i => detectedToolKeys.includes(i.key))
    .map(i => i.name);

  CLIUtils.displayStep(1, 4, 'Detecting agentic coding tools...');
  if (detectedNames.length > 0) {
    CLIUtils.displayStatus('', `Detected: ${detectedNames.join(', ')}`, 'success');
  } else {
    CLIUtils.displayStatus('', 'No agentic coding tools detected', 'warning');
  }
  console.log('');

  // Step 2: Select tools
  CLIUtils.displayStep(2, 4, 'Select target tools');

  // Build choices with descriptive formatting
  const toolChoices = installers.map(installer => ({
    title: installer.name + (detectedToolKeys.includes(installer.key) ? theme.dim(' (detected)') : ''),
    value: installer.key,
    selected: detectedToolKeys.includes(installer.key)
  }));

  console.log(theme.dim('  [Space] toggle  [Enter] confirm  [a] toggle all'));
  console.log(theme.dim(`  ${theme.success('[x]')} = selected    ${theme.dim('[ ]')} = not selected\n`));

  const { selectedToolKeys } = await prompts({
    type: 'multiselect',
    name: 'selectedToolKeys',
    message: 'Choose tools:',
    choices: toolChoices,
    min: 1,
    instructions: false
  });

  if (!selectedToolKeys || selectedToolKeys.length === 0) {
    CLIUtils.displayError('Installation cancelled - no tools selected');
    process.exit(1);
  }

  // Track IDE selection (await to ensure delivery before potential cancel)
  await analytics.trackIdesConfirmed(selectedToolKeys);

  // Step 3: Select Flow
  console.log('');
  CLIUtils.displayStep(3, 4, 'Select SDLC flow');
  console.log(theme.dim(`  Learn more about flows: ${LINKS.flows}\n`));
  const flowChoices = Object.entries(FLOWS).map(([key, flow]) => ({
    title: `${flow.name} - ${flow.description}${flow.message || ''}`,
    value: key,
    disabled: flow.disabled
  }));

  const { selectedFlow } = await prompts({
    type: 'select',
    name: 'selectedFlow',
    message: 'Which SDLC flow would you like to install?',
    choices: flowChoices
  });

  if (!selectedFlow) {
    CLIUtils.displayError('Installation cancelled');
    process.exit(1);
  }

  // Track flow selection (await to ensure delivery before potential cancel)
  await analytics.trackFlowSelected(selectedFlow);

  // Step 4: Install flow files
  console.log('');
  CLIUtils.displayStep(4, 4, `Installing ${FLOWS[selectedFlow].name} flow...`);

  try {
    const filesCreated = await installFlow(selectedFlow, selectedToolKeys);

    // Track successful installation for each tool
    const durationMs = Date.now() - installStartTime;
    for (const toolKey of selectedToolKeys) {
      analytics.trackInstallationCompleted(toolKey, selectedFlow, durationMs, filesCreated);
    }

    CLIUtils.displaySuccess(`${FLOWS[selectedFlow].name} flow installed successfully!`, 'Installation Complete');

    // Get selected tool names for next steps message
    const selectedToolNames = installers
      .filter(i => selectedToolKeys.includes(i.key))
      .map(i => i.name);

    const nextSteps = [
      `Read .specsmd/${selectedFlow}/quick-start.md for getting started`,
      `Open ${selectedToolNames.join(' or ')} and run /specsmd-master-agent`
    ];
    CLIUtils.displayNextSteps(nextSteps);

    // Display IDE extension info with brand colors
    console.log('\n' + theme.primary('─'.repeat(72)));
    console.log(CLIUtils.logoGradient('  ★ IDE Extension'));
    console.log(theme.primary('─'.repeat(72)));
    console.log('');
    console.log('  ' + CLIUtils.logoGradient('Enhance your experience with the specsmd IDE extension!'));
    console.log('');
    console.log(`  ${theme.primary('Learn more:')}                ${LINKS.ideExtension}`);
    console.log(`  ${theme.primary('VS Code:')}                   ${LINKS.vscodeMarketplace}`);
    console.log(`  ${theme.primary('Cursor/Antigravity/Windsurf:')} ${LINKS.openVsx}`);
    console.log('');
    console.log(theme.primary('─'.repeat(72)) + '\n');
    console.log('');
  } catch (error) {
    // Track installation failure
    const errorCategory = categorizeError(error);
    for (const toolKey of selectedToolKeys) {
      analytics.trackInstallationFailed(toolKey, errorCategory, selectedFlow);
    }

    CLIUtils.displayError(`Installation failed: ${error.message}`);
    CLIUtils.displayStatus('', 'The previous state was restored', 'warning');
    process.exit(1);
  }
}

/**
 * Installs a flow for the given tools into options.root (default: the working directory).
 * The whole install is staged first, then applied as one transaction against
 * .specsmd/<flow>/flow.lock: a host edit of an installed file refuses the install unless
 * options.force is set, files the old lock recorded and this install drops are removed,
 * and any failure, the budget check included, restores the previous state.
 * Returns the number of installed files.
 */
async function installFlow(flowKey, toolKeys, options = {}) {
  if (!FLOWS[flowKey]) {
    throw new InstallError(`unknown flow: ${flowKey}`, 'UNKNOWN_FLOW');
  }
  const unknownTools = toolKeys.filter((key) => !InstallerFactory.getInstaller(key));
  if (unknownTools.length > 0) {
    throw new InstallError(`unknown tool(s): ${unknownTools.join(', ')}`, 'UNKNOWN_TOOL', unknownTools);
  }

  const root = path.resolve(options.root || process.cwd());
  const flowPath = path.join(__dirname, '..', 'flows', FLOWS[flowKey].path);
  const version = require('../package.json').version;
  const staged = await stageFlow(flowPath, flowKey, toolKeys, root);

  const manifest = {
    flow: flowKey,
    version,
    installed_at: new Date().toISOString(),
    tools: toolKeys
  };
  const extras = new Map([['.specsmd/manifest.yaml', yaml.dump(manifest)], ...await hostConfigEdits(root, toolKeys)]);

  const count = await applyInstall({
    root,
    flowKey,
    staged,
    extras,
    force: Boolean(options.force),
    version,
    sourceCommit: sourceCommit(),
    log: (line) => console.log(theme.warning(line)),
  });
  CLIUtils.displayStatus('', `Installed ${count} files and wrote .specsmd/${flowKey}/flow.lock`, 'success');
  return count;
}

/**
 * The non-interactive install: `specsmd install --flow <flow> --tools <a,b> [--force]`.
 * Returns the process exit code. Telemetry follows the same opt-outs as the interactive
 * install, DO_NOT_TRACK=1 among them.
 */
async function installScripted({ flow, tools, force } = {}) {
  const toolKeys = String(tools || '').split(',').map((key) => key.trim()).filter(Boolean);
  if (!flow || toolKeys.length === 0) {
    CLIUtils.displayError('a scripted install needs both --flow and --tools');
    return 1;
  }
  analytics.init();
  const started = Date.now();
  try {
    const filesCreated = await installFlow(flow, toolKeys, { force });
    for (const toolKey of toolKeys) {
      analytics.trackInstallationCompleted(toolKey, flow, Date.now() - started, filesCreated);
    }
    return 0;
  } catch (error) {
    for (const toolKey of toolKeys) {
      analytics.trackInstallationFailed(toolKey, categorizeError(error), flow);
    }
    CLIUtils.displayError(`Installation failed: ${error.message}`);
    return 1;
  }
}

async function cleanupToolInstallation(flowKey, toolKeys) {
  const flowPath = path.join(__dirname, '..', 'flows', FLOWS[flowKey].path);
  const dummyConfig = {};

  for (const toolKey of toolKeys) {
    const installer = InstallerFactory.getInstaller(toolKey);
    if (!installer) continue;

    if (typeof installer.uninstallCommands === 'function') {
      await installer.uninstallCommands(flowPath, dummyConfig);
      continue;
    }

    const commandsDir = installer.commandsDir;
    if (await fs.pathExists(commandsDir)) {
      const files = await fs.readdir(commandsDir);
      for (const file of files) {
        if (file.startsWith('specsmd-')) {
          await fs.remove(path.join(commandsDir, file));
        }
      }
    }
  }
}

async function uninstall() {
  CLIUtils.displayHeader('Uninstall', '');

  // Check if specsmd is installed
  if (!await fs.pathExists('.specsmd/manifest.yaml')) {
    CLIUtils.displayWarning('specsmd is not installed in this project');
    return;
  }

  // Read manifest
  const manifestContent = await fs.readFile('.specsmd/manifest.yaml', 'utf8');
  const manifest = yaml.load(manifestContent);

  const installers = InstallerFactory.getInstallers();
  // Support both old 'ides' key and new 'tools' key for backward compatibility
  const installedToolKeys = manifest.tools || manifest.ides || [];
  const installedNames = installers
    .filter(i => installedToolKeys.includes(i.key))
    .map(i => i.name);

  console.log(theme.dim(`Found installation: ${FLOWS[manifest.flow].name} flow`));
  console.log(theme.dim(`Installed for: ${installedNames.join(', ')}\n`));

  const { confirm } = await prompts({
    type: 'confirm',
    name: 'confirm',
    message: 'Are you sure you want to uninstall specsmd?',
    initial: false
  });

  if (!confirm) {
    CLIUtils.displayStatus('', 'Uninstall cancelled', 'warning');
    return;
  }

  // Ask about memory bank
  const { keepMemoryBank } = await prompts({
    type: 'confirm',
    name: 'keepMemoryBank',
    message: 'Keep memory-bank folder? (Contains your project artifacts)',
    initial: true
  });

  console.log(theme.primary('\nUninstalling...\n'));

  try {
    await cleanupToolInstallation(manifest.flow, installedToolKeys);

    // Remove .specsmd directory
    console.log(theme.dim('  Removing .specsmd/...'));
    await fs.remove('.specsmd');

    // Optionally remove memory-bank
    if (!keepMemoryBank && await fs.pathExists('memory-bank')) {
      console.log(theme.dim('  Removing memory-bank/...'));
      await fs.remove('memory-bank');
    }

    CLIUtils.displaySuccess('Uninstall complete!', 'Complete');
    if (keepMemoryBank) {
      console.log(theme.dim('memory-bank/ was preserved\n'));
    }
  } catch (error) {
    CLIUtils.displayError(`Uninstall failed: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  install,
  uninstall,
  installFlow,
  installScripted,
  InstallError,
  cleanupToolInstallation
};
