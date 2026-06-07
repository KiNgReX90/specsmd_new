const fs = require('fs');
const path = require('path');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

function mapStatus(status) {
  if (status === 'completed') return 'complete';
  if (status === 'in_progress') return 'active';
  return 'pending';
}

function formatBoltType(type) {
  return String(type || 'bolt')
    .replace(/-bolt$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function relativeTime(value, now = new Date()) {
  if (!value) return 'unknown';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';

  const seconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function exactTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function classifyArtifactFile(filename) {
  const lower = filename.toLowerCase();
  if (lower.includes('walkthrough') && lower.includes('test')) return 'test-report';
  if (lower.includes('walkthrough')) return 'walkthrough';
  if (lower.includes('test') || lower.includes('report')) return 'test-report';
  if (lower.includes('plan')) return 'plan';
  if (lower.includes('design') || lower.includes('adr')) return 'design';
  return 'other';
}

function scanBoltArtifactFiles(boltPath) {
  try {
    return fs.readdirSync(boltPath)
      .filter((entry) => entry !== 'bolt.md' && entry.endsWith('.md'))
      .map((entry) => ({
        name: entry,
        path: path.join(boltPath, entry),
        type: classifyArtifactFile(entry)
      }));
  } catch {
    return [];
  }
}

function storyPathFor(snapshot, bolt, storyRef) {
  const storyFileName = String(storyRef).endsWith('.md') ? String(storyRef) : `${storyRef}.md`;
  return path.join(
    snapshot.workspacePath,
    'memory-bank',
    'intents',
    bolt.intent || '',
    'units',
    bolt.unit || '',
    'stories',
    storyFileName
  );
}

function buildStoryIndex(snapshot) {
  const index = new Map();
  for (const story of snapshot.stories || []) {
    index.set(story.id, story);
    index.set(path.basename(story.path, '.md'), story);
  }
  return index;
}

function mapBoltStories(snapshot, bolt, storyIndex) {
  return (bolt.stories || []).map((storyRef) => {
    const story = storyIndex.get(storyRef) || storyIndex.get(path.basename(String(storyRef), '.md'));
    return {
      id: storyRef,
      name: story?.title || storyRef,
      status: mapStatus(story?.status),
      path: story?.path || storyPathFor(snapshot, bolt, storyRef)
    };
  });
}

function activeBoltData(snapshot, bolt, storyIndex) {
  const stories = mapBoltStories(snapshot, bolt, storyIndex);
  return {
    id: bolt.id,
    name: bolt.id,
    type: formatBoltType(bolt.type),
    currentStage: bolt.currentStage,
    stagesComplete: (bolt.stages || []).filter((stage) => stage.status === 'completed').length,
    stagesTotal: (bolt.stages || []).length,
    storiesComplete: stories.filter((story) => story.status === 'complete').length,
    storiesTotal: stories.length,
    stages: (bolt.stages || []).map((stage) => ({
      name: stage.name,
      status: mapStatus(stage.status)
    })),
    stories,
    path: bolt.path,
    files: scanBoltArtifactFiles(bolt.path)
  };
}

function queuedBoltData(snapshot, bolt, storyIndex) {
  const stories = mapBoltStories(snapshot, bolt, storyIndex);
  return {
    id: bolt.id,
    name: bolt.id,
    type: formatBoltType(bolt.type),
    storiesCount: stories.length,
    isBlocked: Boolean(bolt.isBlocked),
    blockedBy: bolt.blockedBy || [],
    unblocksCount: bolt.unblocksCount || 0,
    stages: (bolt.stages || []).map((stage) => ({
      name: stage.name,
      status: mapStatus(stage.status)
    })),
    stories
  };
}

function completedBoltData(snapshot, bolt, now) {
  return {
    id: bolt.id,
    name: bolt.id,
    type: formatBoltType(bolt.type),
    completedAt: bolt.completedAt || '',
    relativeTime: relativeTime(bolt.completedAt, now),
    path: bolt.path,
    files: scanBoltArtifactFiles(bolt.path),
    constructionLogPath: bolt.unit
      ? path.join(snapshot.rootPath, 'intents', bolt.intent || '', 'units', bolt.unit, 'construction-log.md')
      : undefined
  };
}

function buildActivityEvents(snapshot, now) {
  const events = [];
  for (const bolt of snapshot.bolts || []) {
    if (bolt.completedAt) {
      events.push({
        id: `${bolt.id}-complete`,
        type: 'bolt-complete',
        text: 'Completed bolt',
        target: bolt.id,
        tag: 'bolt',
        timestamp: bolt.completedAt,
        path: bolt.filePath
      });
    } else if (bolt.startedAt) {
      events.push({
        id: `${bolt.id}-start`,
        type: 'bolt-start',
        text: 'Started bolt',
        target: bolt.id,
        tag: 'bolt',
        timestamp: bolt.startedAt,
        path: bolt.filePath
      });
    } else if (bolt.createdAt) {
      events.push({
        id: `${bolt.id}-created`,
        type: 'bolt-created',
        text: 'Created bolt',
        target: bolt.id,
        tag: 'bolt',
        timestamp: bolt.createdAt,
        path: bolt.filePath
      });
    }
  }

  return events
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, 10)
    .map((event) => ({
      id: event.id,
      type: event.type,
      text: event.text,
      target: event.target,
      tag: event.tag,
      relativeTime: relativeTime(event.timestamp, now),
      exactTime: exactTime(event.timestamp),
      path: event.path
    }));
}

function buildSpecsData(snapshot) {
  const statusSet = new Set();
  const intents = (snapshot.intents || []).map((intent) => {
    const units = (intent.units || []).map((unit) => {
      const status = unit.status === 'completed' ? 'complete' : (unit.status === 'in_progress' ? 'in-progress' : unit.status);
      statusSet.add(status);
      const stories = (unit.stories || []).map((story) => ({
        id: story.id,
        title: story.title,
        path: story.path,
        status: story.status === 'completed' ? 'complete' : (story.status === 'in_progress' ? 'active' : story.status)
      }));
      return {
        name: unit.id || unit.name,
        path: unit.path,
        status,
        storiesComplete: stories.filter((story) => story.status === 'complete').length,
        storiesTotal: stories.length,
        stories
      };
    });

    return {
      name: intent.name,
      number: intent.number,
      path: intent.path,
      storiesComplete: units.reduce((sum, unit) => sum + unit.storiesComplete, 0),
      storiesTotal: units.reduce((sum, unit) => sum + unit.storiesTotal, 0),
      units
    };
  });

  return {
    intents,
    availableStatuses: Array.from(statusSet).sort()
  };
}

function buildStats(snapshot) {
  const stats = snapshot.stats || {};
  return {
    active: stats.activeBoltsCount || 0,
    queued: stats.queuedBolts || 0,
    done: stats.completedBolts || 0,
    blocked: stats.blockedBolts || 0
  };
}

function selectCurrentIntent(snapshot) {
  const activeBolt = (snapshot.activeBolts || [])[0];
  const queuedBolt = (snapshot.pendingBolts || []).find((bolt) => !bolt.isBlocked);
  const selectedBolt = activeBolt || queuedBolt;
  if (!selectedBolt) {
    return { currentIntent: null, currentIntentContext: 'none' };
  }

  const intent = (snapshot.intents || []).find((candidate) =>
    candidate.id === selectedBolt.intent
    || candidate.number === selectedBolt.intent
    || candidate.name === selectedBolt.intent
  );

  return {
    currentIntent: intent ? { name: intent.name, number: intent.number } : null,
    currentIntentContext: activeBolt ? 'active' : 'queued'
  };
}

function buildNextActions(snapshot) {
  const activeBolt = (snapshot.activeBolts || [])[0];
  if (activeBolt) {
    return [{
      type: 'continue-bolt',
      priority: 1,
      title: `Continue ${activeBolt.id}`,
      description: activeBolt.currentStage ? `Current stage: ${activeBolt.currentStage}` : 'Continue the active bolt',
      targetId: activeBolt.id,
      targetName: activeBolt.id
    }];
  }

  const queuedBolt = (snapshot.pendingBolts || []).find((bolt) => !bolt.isBlocked);
  if (queuedBolt) {
    return [{
      type: 'start-bolt',
      priority: 1,
      title: `Start ${queuedBolt.id}`,
      description: `${queuedBolt.stories?.length || 0} stories ready`,
      targetId: queuedBolt.id,
      targetName: queuedBolt.id
    }];
  }

  return [{
    type: 'celebrate',
    priority: 1,
    title: 'All caught up',
    description: 'No active or queued bolts are waiting.'
  }];
}

function buildWebviewData(snapshot) {
  const now = new Date();
  const storyIndex = buildStoryIndex(snapshot);
  const specs = buildSpecsData(snapshot);
  const current = selectCurrentIntent(snapshot);

  return {
    ...current,
    stats: buildStats(snapshot),
    activeBolts: (snapshot.activeBolts || []).map((bolt) => activeBoltData(snapshot, bolt, storyIndex)),
    upNextQueue: (snapshot.pendingBolts || []).map((bolt) => queuedBoltData(snapshot, bolt, storyIndex)),
    completedBolts: (snapshot.completedBolts || []).slice(0, 10).map((bolt) => completedBoltData(snapshot, bolt, now)),
    activityEvents: buildActivityEvents(snapshot, now),
    intents: specs.intents,
    standards: (snapshot.standards || []).map((standard) => ({
      name: standard.name,
      path: standard.filePath
    })),
    nextActions: buildNextActions(snapshot),
    focusCardExpanded: true,
    activityFilter: 'all',
    activityHeight: 200,
    specsFilter: 'all',
    availableStatuses: specs.availableStatuses
  };
}

function getSpecsViewHtml(data) {
  const filter = data.specsFilter || 'all';
  const statusOptionsHtml = (data.availableStatuses || [])
    .map((status) => `<option value="${escapeHtml(status)}"${status === filter ? ' selected' : ''}>${escapeHtml(status)}</option>`)
    .join('');

  const toolbarHtml = `
    <div class="specs-toolbar">
      <span class="specs-toolbar-label">Filter</span>
      <select class="specs-toolbar-select" id="specsFilter">
        <option value="all"${filter === 'all' ? ' selected' : ''}>all</option>
        ${statusOptionsHtml}
      </select>
    </div>`;

  if (!data.intents.length) {
    return `${toolbarHtml}<div class="specs-content"><div class="empty-state"><div class="empty-state-icon">&#128203;</div><div class="empty-state-text">No intents found</div></div></div>`;
  }

  return `${toolbarHtml}
    <div class="specs-content">
      ${data.intents.map((intent) => {
        const progress = intent.storiesTotal > 0 ? Math.round((intent.storiesComplete / intent.storiesTotal) * 100) : 0;
        const dashOffset = 69.115 - (69.115 * progress / 100);
        return `
          <div class="intent-item">
            <div class="intent-header" data-intent="${escapeHtml(intent.number)}">
              <span class="intent-expand">&#9660;</span>
              <span class="intent-icon">&#127919;</span>
              <div class="intent-info">
                <div class="intent-name">${escapeHtml(intent.number)}-${escapeHtml(intent.name)} - intent</div>
                <div class="intent-meta">${intent.units.length} units | ${intent.storiesTotal} stories</div>
              </div>
              <button type="button" class="spec-open-btn intent-open-btn" data-path="${escapeHtml(path.join(intent.path, 'requirements.md'))}" title="Open intent requirements">&#128269;</button>
              <div class="intent-progress-ring">
                <svg width="28" height="28" viewBox="0 0 28 28">
                  <circle class="ring-bg" cx="14" cy="14" r="11"></circle>
                  <circle class="ring-fill" cx="14" cy="14" r="11" style="stroke-dashoffset: ${dashOffset}"></circle>
                </svg>
                <span class="intent-progress-text">${progress}%</span>
              </div>
            </div>
            <div class="intent-content">
              ${intent.units.map((unit) => `
                <div class="unit-item">
                  <div class="unit-header" data-unit="${escapeHtml(unit.name)}">
                    <span class="unit-expand">&#9660;</span>
                    <span class="unit-icon">&#128218;</span>
                    <span class="unit-name">${escapeHtml(unit.name)} - unit</span>
                    <button type="button" class="spec-open-btn unit-open-btn" data-path="${escapeHtml(path.join(unit.path, 'unit-brief.md'))}" title="Open unit brief">&#128269;</button>
                    <span class="unit-progress">${unit.storiesComplete}/${unit.storiesTotal}</span>
                  </div>
                  <div class="unit-content">
                    ${unit.stories.length > 0 ? unit.stories.map((story) => `
                      <div class="spec-story-item" data-path="${escapeHtml(story.path)}">
                        <span class="spec-story-icon">&#128221;</span>
                        <div class="spec-story-status ${escapeHtml(story.status)}">${story.status === 'complete' ? '&#10003;' : story.status === 'active' ? '&#9679;' : ''}</div>
                        <span class="spec-story-name ${story.status === 'complete' ? 'complete' : ''}">${escapeHtml(story.id)}-${escapeHtml(story.title)}</span>
                      </div>
                    `).join('') : '<div class="spec-no-stories">No stories in this unit</div>'}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>`;
      }).join('')}
    </div>`;
}

function getOverviewViewHtml(data) {
  const totalStories = data.intents.reduce((sum, intent) => sum + intent.storiesTotal, 0);
  const completedStories = data.intents.reduce((sum, intent) => sum + intent.storiesComplete, 0);
  const progressPercent = totalStories > 0 ? Math.round((completedStories / totalStories) * 100) : 0;
  const totalBolts = data.stats.active + data.stats.queued + data.stats.done + data.stats.blocked;

  return `<div class="overview-content">
    <div class="overview-section">
      <div class="overview-section-title">Overall Progress</div>
      <div class="overview-progress-bar"><div class="overview-progress-fill" style="width: ${progressPercent}%"></div></div>
      <div class="overview-metrics">
        <div class="overview-metric-card"><div class="overview-metric-value highlight">${progressPercent}%</div><div class="overview-metric-label">Complete</div></div>
        <div class="overview-metric-card"><div class="overview-metric-value success">${completedStories}/${totalStories}</div><div class="overview-metric-label">Stories Done</div></div>
        <div class="overview-metric-card"><div class="overview-metric-value">${data.stats.done}/${totalBolts}</div><div class="overview-metric-label">Bolts Done</div></div>
        <div class="overview-metric-card"><div class="overview-metric-value">${data.intents.length}</div><div class="overview-metric-label">Intents</div></div>
      </div>
    </div>
    <div class="overview-section">
      <div class="overview-section-title">Suggested Actions</div>
      <div class="overview-list">
        ${data.nextActions.slice(0, 3).map((action) => `
          <div class="overview-list-item action-item" data-action-type="${escapeHtml(action.type)}" data-target-id="${escapeHtml(action.targetId || '')}">
            <div class="overview-list-icon action ${escapeHtml(action.type)}">▶</div>
            <div class="overview-list-info">
              <div class="overview-list-name">${escapeHtml(action.title)}</div>
              <div class="overview-list-meta">${escapeHtml(action.description)}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="overview-section">
      <div class="overview-section-title">Intents</div>
      <div class="overview-list">
        ${data.intents.map((intent) => {
          const progress = intent.storiesTotal > 0 ? Math.round((intent.storiesComplete / intent.storiesTotal) * 100) : 0;
          return `
            <div class="overview-list-item" data-intent="${escapeHtml(intent.number)}">
              <div class="overview-list-icon intent">&#128203;</div>
              <div class="overview-list-info">
                <div class="overview-list-name">${escapeHtml(intent.number)}-${escapeHtml(intent.name)}</div>
                <div class="overview-list-meta">${intent.units.length} units | ${intent.storiesTotal} stories</div>
              </div>
              <div class="overview-list-progress">${progress}%</div>
            </div>`;
        }).join('')}
      </div>
    </div>
    <div class="overview-section">
      <div class="overview-section-title">Standards</div>
      <div class="overview-list">
        ${data.standards.length > 0 ? data.standards.map((standard) => `
          <div class="overview-list-item" data-path="${escapeHtml(standard.path)}">
            <div class="overview-list-icon intent">&#128220;</div>
            <div class="overview-list-info"><div class="overview-list-name">${escapeHtml(standard.name)}</div></div>
          </div>
        `).join('') : '<div class="empty-state"><div class="empty-state-text">No standards defined</div></div>'}
      </div>
    </div>
  </div>`;
}

function createSetDataMessage(data) {
  if (!data?.ok || !data.snapshot) {
    return {
      type: 'setData',
      activeTab: 'bolts',
      boltsData: {
        currentIntent: null,
        currentIntentContext: 'none',
        stats: { active: 0, queued: 0, done: 0, blocked: 0 },
        activeBolts: [],
        upNextQueue: [],
        completedBolts: [],
        activityEvents: [],
        focusCardExpanded: true,
        activityFilter: 'all',
        activityHeight: 200,
        specsFilter: 'all'
      },
      specsHtml: '',
      overviewHtml: '',
      availableFlows: [],
      activeFlowId: null
    };
  }

  const webviewData = buildWebviewData(data.snapshot);
  return {
    type: 'setData',
    activeTab: 'bolts',
    boltsData: {
      currentIntent: webviewData.currentIntent,
      currentIntentContext: webviewData.currentIntentContext,
      stats: webviewData.stats,
      activeBolts: webviewData.activeBolts,
      upNextQueue: webviewData.upNextQueue,
      completedBolts: webviewData.completedBolts,
      activityEvents: webviewData.activityEvents,
      focusCardExpanded: webviewData.focusCardExpanded,
      activityFilter: webviewData.activityFilter,
      activityHeight: webviewData.activityHeight,
      specsFilter: webviewData.specsFilter
    },
    specsHtml: getSpecsViewHtml(webviewData),
    overviewHtml: getOverviewViewHtml(webviewData),
    availableFlows: [{
      id: data.flow,
      displayName: data.flow === 'aidlc' ? 'AI-DLC' : data.flow,
      icon: data.flow === 'aidlc' ? '$(rocket)' : '$(folder)',
      rootFolder: data.flow === 'aidlc' ? 'memory-bank' : data.flow
    }],
    activeFlowId: data.flow
  };
}

module.exports = {
  buildWebviewData,
  createSetDataMessage,
  getOverviewViewHtml,
  getSpecsViewHtml
};
