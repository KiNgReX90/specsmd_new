
// Theme Colors (dark red)
const THEME_COLORS = {
    primary: '#A83232',      // Dark brick red
    secondary: '#C04545',    // Medium red
    accent: '#D85858',       // Coral red
    success: '#22c55e',      // Green
    error: '#ef4444',        // Red
    warning: '#f59e0b',      // Amber
    info: '#3b82f6',         // Blue
    dim: '#666666'           // Gray shadow (visible on dark/light terminals)
};

// `entryCommand` is the slash command a user runs first after installing a flow.
// The installer prints it in the next-steps message (installer.js). Not every flow
// ships a `/specsmd-master-agent`; each names its own real entry command here.
const FLOWS = {
    fire: {
        name: 'FIRE',
        description: 'Adaptive execution - Brownfield/monorepo ready, right-sizes rigor to complexity',
        path: 'fire',
        entryCommand: '/specsmd-fire'
    },
    aidlc: {
        name: 'AI-DLC',
        description: 'Full methodology - Comprehensive traceability, DDD or Simple bolt types',
        path: 'aidlc',
        entryCommand: '/specsmd-master-agent'
    },
    'aidlc-turbo': {
        name: 'AI-DLC Turbo',
        description: 'Slim AI-DLC - lean inception (requirements + decisions-and-gates ledger + stories, no ceremony) and story-driven construction, no bolts',
        path: 'aidlc-turbo',
        entryCommand: '/specsmd-aidlc-turbo'
    },
    simple: {
        name: 'Simple',
        description: 'Spec generation only (Kiro style) - Creates requirement/design/task docs, no execution tracking',
        path: 'simple',
        entryCommand: '/specsmd-agent'
    },
    ideation: {
        name: 'Ideation',
        description: 'Creative ideation - Spark → Flame → Forge idea generation and shaping',
        path: 'ideation',
        entryCommand: '/specsmd-ideation'
    },
    inferno: {
        name: 'INFERNO',
        description: 'Autonomous parallel execution - decomposes an intent into work items and runs parallel autopilot builders in one worktree',
        path: 'inferno',
        entryCommand: '/specsmd-inferno-planner'
    }
};

const LINKS = {
    website: 'https://specs.md',
    flows: 'https://specs.md/architecture/flows',
    ideExtension: 'https://specs.md/getting-started/ide-extension',
    vscodeMarketplace: 'https://marketplace.visualstudio.com/items?itemName=fabriqaai.specsmd',
    openVsx: 'https://open-vsx.org/extension/fabriqaai/specsmd'
};

module.exports = {
    THEME_COLORS,
    FLOWS,
    LINKS
};
