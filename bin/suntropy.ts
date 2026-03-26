import { createProgram } from '../src/index.js';

const program = createProgram();
program.parseAsync(process.argv).catch((err) => {
  process.stderr.write(JSON.stringify({ error: true, message: err.message }) + '\n');
  process.exit(1);
});
