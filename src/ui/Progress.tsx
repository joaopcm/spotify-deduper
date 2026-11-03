import { Text } from "ink";

const BAR_WIDTH = 30;

export function Progress({ label, done, total }: { label: string; done: number; total: number }) {
  const filled = total === 0 ? BAR_WIDTH : Math.round((done / total) * BAR_WIDTH);
  return (
    <Text>
      {label} <Text color="green">{"█".repeat(filled)}</Text>
      <Text dimColor>{"░".repeat(BAR_WIDTH - filled)}</Text> {done}/{total}
    </Text>
  );
}
