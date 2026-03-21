export interface CliToneMeta {
  label: string;
  solid: string;
  soft: string;
  border: string;
  text: string;
  hover: string;
}

const CLI_TONES = {
  claude: {
    label: "Claude Code",
    solid: "var(--cli-claude-solid)",
    soft: "var(--cli-claude-soft)",
    border: "var(--cli-claude-border)",
    text: "var(--cli-claude-text)",
    hover: "var(--cli-claude-hover)",
  },
  opencode: {
    label: "OpenCode",
    solid: "var(--cli-opencode-solid)",
    soft: "var(--cli-opencode-soft)",
    border: "var(--cli-opencode-border)",
    text: "var(--cli-opencode-text)",
    hover: "var(--cli-opencode-hover)",
  },
  kilo: {
    label: "Kilo",
    solid: "var(--cli-kilo-solid)",
    soft: "var(--cli-kilo-soft)",
    border: "var(--cli-kilo-border)",
    text: "var(--cli-kilo-text)",
    hover: "var(--cli-kilo-hover)",
  },
  git: {
    label: "Git",
    solid: "var(--cli-git-solid)",
    soft: "var(--cli-git-soft)",
    border: "var(--cli-git-border)",
    text: "var(--cli-git-text)",
    hover: "var(--cli-git-hover)",
  },
  ide: {
    label: "IDE",
    solid: "var(--info-soft)",
    soft: "color-mix(in srgb, var(--info) 14%, var(--surface-2))",
    border: "color-mix(in srgb, var(--info) 45%, transparent)",
    text: "var(--info)",
    hover: "var(--info)",
  },
  folder: {
    label: "Folder",
    solid: "var(--cli-folder-solid)",
    soft: "var(--cli-folder-soft)",
    border: "var(--cli-folder-border)",
    text: "var(--cli-folder-text)",
    hover: "var(--cli-folder-hover)",
  },
  terminal: {
    label: "Terminal",
    solid: "var(--cli-terminal-solid)",
    soft: "var(--cli-terminal-soft)",
    border: "var(--cli-terminal-border)",
    text: "var(--cli-terminal-text)",
    hover: "var(--cli-terminal-hover)",
  },
  custom: {
    label: "Custom",
    solid: "var(--cli-custom-solid)",
    soft: "var(--cli-custom-soft)",
    border: "var(--cli-custom-border)",
    text: "var(--cli-custom-text)",
    hover: "var(--cli-custom-hover)",
  },
} satisfies Record<string, CliToneMeta>;

export function getCliTone(cliType: string): CliToneMeta {
  return CLI_TONES[cliType as keyof typeof CLI_TONES] ?? CLI_TONES.claude;
}
