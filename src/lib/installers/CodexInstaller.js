const ToolInstaller = require('./ToolInstaller');
const fs = require('fs-extra');
const path = require('path');
const CLIUtils = require('../cli-utils');
const { theme } = CLIUtils;

const MANAGED_START = '<!-- specsmd:codex:start -->';
const MANAGED_END = '<!-- specsmd:codex:end -->';

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function removeDirIfEmpty(dir) {
    if (!await fs.pathExists(dir)) return;
    const entries = await fs.readdir(dir);
    if (entries.length === 0) await fs.remove(dir);
}

class CodexInstaller extends ToolInstaller {
    get key() {
        return 'codex';
    }

    get name() {
        return 'Codex';
    }

    // Retained for flows that still use command-to-skill conversion.
    get commandsDir() {
        return path.join('.codex', 'skills');
    }

    get nativeSkillsDir() {
        return path.join('.agents', 'skills');
    }

    get nativeAgentsDir() {
        return path.join('.codex', 'agents');
    }

    get detectPath() {
        return '.codex';
    }

    async installCommands(flowPath, config) {
        const nativeDir = path.join(flowPath, 'codex');
        if (await fs.pathExists(nativeDir)) {
            return this.installNativeBundle(nativeDir);
        }
        return this.installLegacyCommands(flowPath, config);
    }

    async installNativeBundle(nativeDir) {
        const installedFiles = [];
        const sourceSkillsDir = path.join(nativeDir, 'skills');
        const sourceAgentsDir = path.join(nativeDir, 'agents');

        if (await fs.pathExists(sourceSkillsDir)) {
            console.log(theme.dim(`  Installing native skills to ${this.nativeSkillsDir}/...`));
            await fs.ensureDir(this.nativeSkillsDir);
            const skillEntries = await fs.readdir(sourceSkillsDir, { withFileTypes: true });
            for (const entry of skillEntries) {
                if (!entry.isDirectory()) continue;
                const target = path.join(this.nativeSkillsDir, entry.name);
                await fs.copy(path.join(sourceSkillsDir, entry.name), target, { overwrite: true });
                installedFiles.push(target);
            }
        }

        if (await fs.pathExists(sourceAgentsDir)) {
            console.log(theme.dim(`  Installing custom agents to ${this.nativeAgentsDir}/...`));
            await fs.ensureDir(this.nativeAgentsDir);
            const agentEntries = await fs.readdir(sourceAgentsDir, { withFileTypes: true });
            for (const entry of agentEntries) {
                if (!entry.isFile() || !entry.name.endsWith('.toml')) continue;
                const target = path.join(this.nativeAgentsDir, entry.name);
                await fs.copy(path.join(sourceAgentsDir, entry.name), target, { overwrite: true });
                installedFiles.push(target);
            }
        }

        const appendixPath = path.join(nativeDir, 'AGENTS.append.md');
        if (await fs.pathExists(appendixPath)) {
            await this.installAgentsInstructions(await fs.readFile(appendixPath, 'utf8'));
            installedFiles.push('AGENTS.md');
        }

        CLIUtils.displayStatus('', `Installed ${installedFiles.length} native assets for ${this.name}`, 'success');
        return installedFiles;
    }

    async installAgentsInstructions(appendix) {
        let current = '';
        if (await fs.pathExists('AGENTS.md')) {
            current = await fs.readFile('AGENTS.md', 'utf8');
        } else if (await fs.pathExists('CLAUDE.md')) {
            const claude = await fs.readFile('CLAUDE.md', 'utf8');
            current = claude.replace(/^#\s+CLAUDE\.md\b/, '# AGENTS.md');
        }

        const block = `${MANAGED_START}\n${appendix.trim()}\n${MANAGED_END}`;
        const managedPattern = new RegExp(
            `${escapeRegExp(MANAGED_START)}[\\s\\S]*?${escapeRegExp(MANAGED_END)}`
        );

        let next;
        if (managedPattern.test(current)) {
            next = current.replace(managedPattern, block);
        } else if (current.length > 0) {
            const separator = current.endsWith('\n') ? '\n' : '\n\n';
            next = `${current}${separator}${block}\n`;
        } else {
            next = `${block}\n`;
        }

        await fs.writeFile('AGENTS.md', next, 'utf8');
    }

    async installLegacyCommands(flowPath, config) {
        const targetSkillsDir = this.commandsDir;
        console.log(theme.dim(`  Installing skills to ${targetSkillsDir}/...`));
        await fs.ensureDir(targetSkillsDir);

        const commandsSourceDir = path.join(flowPath, 'commands');
        if (!await fs.pathExists(commandsSourceDir)) {
            console.log(theme.warning(`  No commands folder found at ${commandsSourceDir}`));
            return [];
        }

        const commandFiles = await fs.readdir(commandsSourceDir);
        const installedFiles = [];

        for (const cmdFile of commandFiles) {
            if (!cmdFile.endsWith('.md')) continue;

            try {
                const sourcePath = path.join(commandsSourceDir, cmdFile);
                const content = await fs.readFile(sourcePath, 'utf8');
                const commandName = cmdFile.replace('.md', '');
                const prefix = (config && config.command && config.command.prefix) ? `${config.command.prefix}-` : '';
                const skillName = `specsmd-${prefix}${commandName}`;

                const { description, body } = this.parseFrontmatter(content);
                const skillContent = [
                    '---',
                    `name: ${skillName}`,
                    `description: "${description || 'specsmd agent'}"`,
                    '---',
                    '',
                    body
                ].join('\n');

                const skillDir = path.join(targetSkillsDir, skillName);
                await fs.ensureDir(skillDir);
                await fs.writeFile(path.join(skillDir, 'SKILL.md'), skillContent, 'utf8');
                installedFiles.push(skillName);
            } catch (err) {
                console.log(theme.warning(`  Failed to install ${cmdFile}: ${err.message}`));
            }
        }

        CLIUtils.displayStatus('', `Installed ${installedFiles.length} skills for ${this.name}`, 'success');
        return installedFiles;
    }

    async uninstallCommands(flowPath, config) {
        const nativeDir = path.join(flowPath, 'codex');
        if (await fs.pathExists(nativeDir)) {
            await this.uninstallNativeBundle(nativeDir);
        }
        await this.uninstallLegacyCommands(flowPath, config);
    }

    async uninstallNativeBundle(nativeDir) {
        const sourceSkillsDir = path.join(nativeDir, 'skills');
        if (await fs.pathExists(sourceSkillsDir)) {
            const entries = await fs.readdir(sourceSkillsDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    await fs.remove(path.join(this.nativeSkillsDir, entry.name));
                }
            }
        }

        const sourceAgentsDir = path.join(nativeDir, 'agents');
        if (await fs.pathExists(sourceAgentsDir)) {
            const entries = await fs.readdir(sourceAgentsDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isFile() && entry.name.endsWith('.toml')) {
                    await fs.remove(path.join(this.nativeAgentsDir, entry.name));
                }
            }
        }

        await this.removeManagedAgentsBlock();
        await removeDirIfEmpty(this.nativeSkillsDir);
        await removeDirIfEmpty(path.dirname(this.nativeSkillsDir));
        await removeDirIfEmpty(this.nativeAgentsDir);
        await removeDirIfEmpty(path.dirname(this.nativeAgentsDir));
    }

    async uninstallLegacyCommands(flowPath, config) {
        const commandsSourceDir = path.join(flowPath, 'commands');
        if (!await fs.pathExists(commandsSourceDir)) return;

        const prefix = (config && config.command && config.command.prefix) ? `${config.command.prefix}-` : '';
        const commandFiles = await fs.readdir(commandsSourceDir);
        for (const cmdFile of commandFiles) {
            if (!cmdFile.endsWith('.md')) continue;
            const commandName = cmdFile.slice(0, -3);
            await fs.remove(path.join(this.commandsDir, `specsmd-${prefix}${commandName}`));
        }
        await removeDirIfEmpty(this.commandsDir);
        await removeDirIfEmpty(path.dirname(this.commandsDir));
    }

    async removeManagedAgentsBlock() {
        if (!await fs.pathExists('AGENTS.md')) return;
        const current = await fs.readFile('AGENTS.md', 'utf8');
        const managedPattern = new RegExp(
            `${escapeRegExp(MANAGED_START)}[\\s\\S]*?${escapeRegExp(MANAGED_END)}(?:\\r?\\n)?`
        );
        if (!managedPattern.test(current)) return;
        await fs.writeFile('AGENTS.md', current.replace(managedPattern, ''), 'utf8');
    }

    /** Parse YAML frontmatter from a markdown file. */
    parseFrontmatter(content) {
        const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
        if (!match) return { description: '', body: content };

        const frontmatter = match[1];
        const body = match[2];
        const descMatch = frontmatter.match(/description:\s*["']?(.+?)["']?\s*$/m);
        return {
            description: descMatch ? descMatch[1] : '',
            body: body.trim()
        };
    }
}

CodexInstaller.MANAGED_START = MANAGED_START;
CodexInstaller.MANAGED_END = MANAGED_END;

module.exports = CodexInstaller;
