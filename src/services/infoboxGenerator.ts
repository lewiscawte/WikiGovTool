export interface InfoboxOfficeholderInput {
  name: string;
  office: string;
  department?: string;
  party?: string;
  termStart?: string;
  termEnd?: string;
  predecessor?: string;
  successor?: string;
}

export function generateOfficeholderInfobox(input: InfoboxOfficeholderInput): string {
  const lines = ['{{Infobox officeholder'];
  const push = (key: string, value?: string) => {
    lines.push(`| ${key.padEnd(12)} = ${value ?? ''}`);
  };

  push('name', input.name);
  push('office', input.office);
  if (input.department) push('department', input.department);
  push('party', input.party);
  push('term_start', input.termStart);
  push('term_end', input.termEnd);
  if (input.predecessor) push('predecessor', input.predecessor);
  if (input.successor) push('successor', input.successor);
  lines.push('}}');
  return lines.join('\n');
}