import { Command } from 'commander';
import axios from 'axios';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { createServiceClient, handleApiError, type ClientOptions } from '../../client.js';
import { output, outputError, type OutputOptions } from '../../output.js';

function getGlobalOpts(cmd: Command): OutputOptions & ClientOptions {
  let root = cmd;
  while (root.parent) root = root.parent;
  return root.opts() as any;
}

const BASE = '/api/alexandria-projects';

/** Largest file the command will pull into the sandbox (the backend caps uploads at 25 MB). */
const MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024;

interface ProjectFile {
  id: number;
  name: string;
  url: string;
  size: number | null;
  mimeType: string | null;
}

function parseId(value: string, what: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid ${what}: "${value}". It must be a number (see \`suntropy projects list\`).`);
  }
  return Number(value);
}

function parseVisibility(value?: string): 'PRIVATE' | 'CLIENT' | undefined {
  if (value === undefined) return undefined;
  const upper = value.toUpperCase();
  if (upper !== 'PRIVATE' && upper !== 'CLIENT') {
    throw new Error(`Invalid --visibility "${value}". Use "private" (only you) or "client" (everyone in the account).`);
  }
  return upper;
}

/** Body for create/update from the flags that were actually passed. */
function projectBody(opts: Record<string, string | undefined>): Record<string, string> {
  if (opts.instructions !== undefined && opts.instructionsFile !== undefined) {
    throw new Error('Use either --instructions or --instructions-file, not both.');
  }
  const body: Record<string, string> = {};
  if (opts.name !== undefined) body.name = opts.name;
  if (opts.description !== undefined) body.description = opts.description;
  if (opts.instructions !== undefined) body.instructions = opts.instructions;
  if (opts.instructionsFile !== undefined) {
    body.instructions = readFileSync(opts.instructionsFile, 'utf8');
  }
  const visibility = parseVisibility(opts.visibility);
  if (visibility) body.visibility = visibility;
  return body;
}

/**
 * A name that can only ever land inside the output directory: the file name
 * comes from whoever uploaded the document, so it is not trusted as a path.
 */
export function safeFileName(name: string, fallback: string): string {
  const base = basename(name.replace(/\\/g, '/')).replace(/[\u0000-\u001f]/g, '').trim();
  return base && base !== '.' && base !== '..' ? base : fallback;
}

/** `name.ext` → `name (2).ext` until `isTaken` stops saying the name is in use. */
export function uniqueName(name: string, isTaken: (name: string) => boolean): string {
  if (!isTaken(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!isTaken(candidate)) return candidate;
  }
}

async function downloadFile(file: ProjectFile, outDir: string, taken: Set<string>) {
  const url = new URL(file.url);
  if (url.protocol !== 'https:') {
    throw new Error(`Refusing to download "${file.name}": the link is not https.`);
  }
  // Taken = written by this run, or already in the folder (a rerun must not overwrite it).
  const name = uniqueName(
    safeFileName(file.name, `file-${file.id}`),
    (candidate) => taken.has(candidate.toLowerCase()) || existsSync(join(outDir, candidate)),
  );
  taken.add(name.toLowerCase());
  const target = resolve(outDir, name);
  if (!target.startsWith(resolve(outDir) + sep)) {
    throw new Error(`Refusing to write "${file.name}" outside ${outDir}.`);
  }

  // Plain axios on purpose: the Suntropy token must not travel to the document host.
  const res = await axios.get<ArrayBuffer>(file.url, {
    responseType: 'arraybuffer',
    timeout: 120000,
    maxContentLength: MAX_DOWNLOAD_BYTES,
    maxBodyLength: MAX_DOWNLOAD_BYTES,
  });
  const content = Buffer.from(res.data);
  writeFileSync(target, content);
  return { id: file.id, name, path: join(outDir, name), size: content.byteLength };
}

export function registerProjectsCommands(program: Command): void {
  const projects = program.command('projects').description(
    'Alexandria projects: groups of conversations with their own instructions and documents.\n' +
    'A project is private (only its owner) or shared with the whole account (visibility client).\n' +
    'Ids come from `suntropy projects list`.'
  );

  // --- list ---
  projects
    .command('list')
    .description('List the projects you can see: yours and the ones shared with your account.')
    .action(async () => {
      try {
        const global = getGlobalOpts(projects);
        const client = createServiceClient('solar', global);
        const res = await client.get(BASE);
        output(res.data, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- get ---
  projects
    .command('get <id>')
    .description('Show a project with its instructions and files.')
    .action(async (id: string) => {
      try {
        const global = getGlobalOpts(projects);
        const client = createServiceClient('solar', global);
        const res = await client.get(`${BASE}/${parseId(id, 'project id')}`);
        output(res.data, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- create ---
  projects
    .command('create')
    .description(
      'Create a project.\n\n' +
      'Examples:\n' +
      '  suntropy projects create --name "Casa García" --instructions "Responde siempre con kWh"\n' +
      '  suntropy projects create --name "Industria" --instructions-file ./agent.md --visibility client'
    )
    .requiredOption('--name <name>', 'Project name (max 120 characters)')
    .option('--description <text>', 'Short description (max 500 characters)')
    .option('--instructions <text>', 'Instructions Alexandria follows in every conversation of the project (max 8000 characters)')
    .option('--instructions-file <path>', 'Read the instructions from a file instead')
    .option('--visibility <visibility>', 'private (default, only you) | client (everyone in the account)')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(projects);
        const client = createServiceClient('solar', global);
        const res = await client.post(BASE, projectBody(opts));
        output(res.data, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- update ---
  projects
    .command('update <id>')
    .description('Change a project (owner or account admin). Only the flags you pass are changed.')
    .option('--name <name>', 'New name')
    .option('--description <text>', 'New description')
    .option('--instructions <text>', 'New instructions')
    .option('--instructions-file <path>', 'Read the new instructions from a file')
    .option('--visibility <visibility>', 'private | client (only the owner can change it)')
    .action(async (id: string, opts) => {
      try {
        const global = getGlobalOpts(projects);
        const client = createServiceClient('solar', global);
        const body = projectBody(opts);
        if (Object.keys(body).length === 0) {
          throw new Error('Nothing to update. Pass at least one of --name, --description, --instructions, --instructions-file, --visibility.');
        }
        const res = await client.put(`${BASE}/${parseId(id, 'project id')}`, body);
        output(res.data, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- delete ---
  projects
    .command('delete <id>')
    .description('Delete a project and its file list (owner or account admin). Conversations are kept, only unlinked.')
    .action(async (id: string) => {
      try {
        const global = getGlobalOpts(projects);
        const client = createServiceClient('solar', global);
        const projectId = parseId(id, 'project id');
        await client.delete(`${BASE}/${projectId}`);
        output({ deleted: true, id: projectId }, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- files ---
  const files = projects.command('files').description('Documents of a project.');

  files
    .command('list <projectId>')
    .description('List the files of a project (id, name, size, type).')
    .action(async (projectId: string) => {
      try {
        const global = getGlobalOpts(projects);
        const client = createServiceClient('solar', global);
        const res = await client.get(`${BASE}/${parseId(projectId, 'project id')}`);
        output(res.data.files ?? [], global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  files
    .command('add <projectId>')
    .description(
      'Add a document already uploaded to the Suntropy document store to a project (owner or account admin).\n' +
      'The url must be an https link to *.enerlence.com, e.g. the downloadUrl of an uploaded sandbox file.\n\n' +
      'Example:\n' +
      '  suntropy projects files add 12 --name factura.pdf --url https://documents.enerlence.com/f/abc/?dl=1'
    )
    .requiredOption('--name <name>', 'File name, with extension')
    .requiredOption('--url <url>', 'https link to the document')
    .option('--size <bytes>', 'Size in bytes (max 25 MB)')
    .option('--mime <type>', 'MIME type, e.g. application/pdf')
    .action(async (projectId: string, opts) => {
      try {
        const global = getGlobalOpts(projects);
        const client = createServiceClient('solar', global);
        const body: Record<string, unknown> = { name: opts.name, url: opts.url };
        if (opts.size !== undefined) {
          if (!/^\d+$/.test(opts.size)) throw new Error(`Invalid --size "${opts.size}". Pass the size in bytes.`);
          body.size = Number(opts.size);
        }
        if (opts.mime !== undefined) body.mimeType = opts.mime;
        const res = await client.post(`${BASE}/${parseId(projectId, 'project id')}/files`, body);
        output(res.data, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  files
    .command('remove <projectId> <fileId>')
    .description('Remove a file from a project (owner or account admin).')
    .action(async (projectId: string, fileId: string) => {
      try {
        const global = getGlobalOpts(projects);
        const client = createServiceClient('solar', global);
        const id = parseId(projectId, 'project id');
        const file = parseId(fileId, 'file id');
        await client.delete(`${BASE}/${id}/files/${file}`);
        output({ removed: true, projectId: id, fileId: file }, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  files
    .command('download <projectId>')
    .description(
      'Download the files of a project into a local folder, e.g. to read them in the sandbox.\n' +
      'Pass --file <fileId> for one file or --all for every file.\n\n' +
      'Examples:\n' +
      '  suntropy projects files download 12 --all --out ./project-files\n' +
      '  suntropy projects files download 12 --file 34'
    )
    .option('--file <fileId>', 'Id of one file (see `projects files list`)')
    .option('--all', 'Download every file of the project')
    .option('--out <dir>', 'Folder to write into (created if missing)', './project-files')
    .action(async (projectId: string, opts) => {
      try {
        const global = getGlobalOpts(projects);
        if (!opts.all && opts.file === undefined) {
          throw new Error('Say what to download: --all, or --file <fileId> (see `suntropy projects files list <projectId>`).');
        }
        if (opts.all && opts.file !== undefined) {
          throw new Error('Use either --all or --file, not both.');
        }
        const client = createServiceClient('solar', global);
        const res = await client.get(`${BASE}/${parseId(projectId, 'project id')}`);
        const all: ProjectFile[] = res.data.files ?? [];

        let selected = all;
        if (opts.file !== undefined) {
          const fileId = parseId(opts.file, 'file id');
          selected = all.filter((f) => f.id === fileId);
          if (selected.length === 0) {
            throw new Error(`File ${fileId} is not in project ${projectId}. See \`suntropy projects files list ${projectId}\`.`);
          }
        }
        if (selected.length === 0) {
          output({ downloaded: [], note: 'The project has no files.' }, global);
          return;
        }

        const outDir = resolve(opts.out);
        mkdirSync(outDir, { recursive: true });
        const taken = new Set<string>();

        const downloaded = [];
        const failed = [];
        for (const file of selected) {
          try {
            downloaded.push(await downloadFile(file, outDir, taken));
          } catch (err) {
            failed.push({ id: file.id, name: file.name, error: err instanceof Error ? err.message : String(err) });
          }
        }
        output({ outDir, downloaded, ...(failed.length ? { failed } : {}) }, global);
        if (failed.length) process.exitCode = 1;
      } catch (err) {
        outputError(handleApiError(err));
      }
    });
}
