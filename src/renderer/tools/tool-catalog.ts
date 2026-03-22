export interface ToolInfo {
  command: string;
  name: string;
  description: string;
}

const tools: ToolInfo[] = [
  { command: 'gh', name: 'GitHub CLI', description: 'efficient GitHub access instead of web fetching' },
  { command: 'jq', name: 'jq', description: 'efficient JSON processing' },
  { command: 'rg', name: 'ripgrep', description: 'fast recursive text search' },
  { command: 'fd', name: 'fd', description: 'fast file finding' },
  { command: 'tree', name: 'tree', description: 'directory structure visualization' },
  { command: 'yq', name: 'yq', description: 'YAML/XML/TOML processing' },
  { command: 'shellcheck', name: 'ShellCheck', description: 'shell script linting and analysis' },
  { command: 'make', name: 'Make', description: 'build automation' },
  { command: 'cmake', name: 'CMake', description: 'cross-platform build system generation' },
  { command: 'docker', name: 'Docker', description: 'container management' },
  { command: 'kubectl', name: 'kubectl', description: 'Kubernetes cluster management' },
  { command: 'terraform', name: 'Terraform', description: 'infrastructure as code provisioning' },
  { command: 'aws', name: 'AWS CLI', description: 'AWS cloud service management' },
  { command: 'gcloud', name: 'Google Cloud CLI', description: 'Google Cloud service management' },
  { command: 'az', name: 'Azure CLI', description: 'Azure cloud service management' },
  { command: 'python3', name: 'Python 3', description: 'Python scripting and automation' },
  { command: 'wget', name: 'wget', description: 'file downloading from the web' },
];

const toolMap = new Map(tools.map(t => [t.command, t]));

export function findTool(command: string): ToolInfo | undefined {
  return toolMap.get(command);
}
