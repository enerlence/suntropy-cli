/**
 * Entrada del usuario sin dejar rastro de los secretos.
 *
 * - Con terminal: pregunta por stderr y lee sin eco (`hidden`).
 * - Sin terminal (un agente que canaliza la entrada): lee stdin entero una vez y
 *   va entregando una línea por pregunta, en orden. Así se puede hacer
 *   `printf '%s\n' "$CLAVE" | suntropy connect add …` sin que la clave aparezca
 *   en la línea de comandos ni en el historial.
 */

let stdinLines: string[] | null = null;

async function readAllStdin(): Promise<string[]> {
  if (stdinLines) return stdinLines;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  stdinLines = Buffer.concat(chunks)
    .toString('utf-8')
    .split(/\r?\n/);
  // La última línea vacía tras el salto final no cuenta.
  if (stdinLines.length && stdinLines[stdinLines.length - 1] === '') stdinLines.pop();
  return stdinLines;
}

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

export async function ask(question: string, opts: { hidden?: boolean } = {}): Promise<string> {
  if (!process.stdin.isTTY) {
    const lines = await readAllStdin();
    const line = lines.shift();
    if (line === undefined) {
      throw new Error(`Falta un valor por stdin para: ${question.replace(/:\s*$/, '')}`);
    }
    return line.trim();
  }
  process.stderr.write(question);
  if (!opts.hidden) {
    return new Promise((resolve) => {
      const onData = (d: Buffer) => {
        process.stdin.off('data', onData);
        process.stdin.pause();
        resolve(d.toString('utf-8').split(/\r?\n/)[0].trim());
      };
      process.stdin.resume();
      process.stdin.on('data', onData);
    });
  }
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf-8');
    const done = (err?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      process.stderr.write('\n');
      if (err) reject(err);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n' || ch === '\u0004') return done();
        if (ch === '\u0003') return done(new Error('Cancelado.'));
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
