import { isPlaceholder } from './secrets';
import { maskSecret } from './mask';
import type { Finding, Severity } from './types';

type Rule = { id: string; severity: Severity; title: string; fix: string };

const R = {
  latest: { id: 'DOCKER-LATEST-TAG', severity: 'medium', title: 'Imagen base sin versión fija (latest)', fix: 'Fija una versión concreta (por ejemplo `node:22.11-slim`) o, mejor, un digest `@sha256:`. Con `latest` la construcción cambia sin avisar.' },
  root: { id: 'DOCKER-ROOT-USER', severity: 'medium', title: 'El contenedor se ejecuta como root', fix: 'Crea un usuario sin privilegios y agrégalo antes del comando final: `RUN adduser --system app` y `USER app`.' },
  curlSh: { id: 'DOCKER-CURL-PIPE-SH', severity: 'high', title: 'Se ejecuta un script descargado sin verificarlo', fix: 'Descarga el archivo, verifica su checksum o firma y recién entonces ejecútalo. Evita `curl ... | sh`.' },
  addUrl: { id: 'DOCKER-ADD-URL', severity: 'medium', title: 'ADD descarga un archivo remoto sin verificarlo', fix: 'Usa `RUN curl` con verificación de checksum, o COPY de un archivo que ya hayas validado.' },
  chmod: { id: 'DOCKER-CHMOD-777', severity: 'medium', title: 'Permisos 777 en el contenedor', fix: 'Da solo los permisos necesarios (por ejemplo 755 para ejecutables y 644 para archivos).' },
  ssh: { id: 'DOCKER-EXPOSE-SSH', severity: 'medium', title: 'Se expone el puerto 22 (SSH)', fix: 'No ejecutes SSH dentro del contenedor: usa `docker exec` o el orquestador para acceder.' },
  secret: { id: 'DOCKER-SECRET-ENV', severity: 'high', title: 'Secreto escrito en ENV o ARG', fix: 'No pongas credenciales en la imagen: quedan en sus capas. Pásalas al ejecutar (variables de entorno o secretos del orquestador) y cambia la que expusiste.' },
  privileged: { id: 'COMPOSE-PRIVILEGED', severity: 'high', title: 'Contenedor privilegiado', fix: 'Quita `privileged: true`; si necesitas una capacidad concreta, agrégala con `cap_add`.' },
  hostNet: { id: 'COMPOSE-HOST-NETWORK', severity: 'medium', title: 'Contenedor en la red del host', fix: 'Usa la red por defecto y publica solo los puertos necesarios.' },
  sock: { id: 'COMPOSE-DOCKER-SOCKET', severity: 'high', title: 'Se monta el socket de Docker en un contenedor', fix: 'Quien controla el socket controla el servidor. Evítalo o usa un proxy de socket con permisos limitados.' },
  composeLatest: { id: 'COMPOSE-LATEST-TAG', severity: 'low', title: 'Imagen sin versión fija (latest)', fix: 'Fija una versión concreta de la imagen.' },
} satisfies Record<string, Rule>;

const SECRET_NAME = /(PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIAL)/i;

const finding = (rule: Rule, file: string, line: number, snippet: string, extra = ''): Finding => ({
  ruleId: rule.id, category: 'config', severity: rule.severity, file, line,
  snippet: snippet.trim().slice(0, 200), title: rule.title + extra, fix: rule.fix,
});

interface Instruction {
  line: number;
  op: string;
  args: string;
  raw: string;
}

/** Une las líneas continuadas con `\` e ignora comentarios. */
function instructions(text: string): Instruction[] {
  const out: Instruction[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const first = (lines[i] as string).trim();
    if (first === '' || first.startsWith('#')) continue;
    let joined = first;
    let j = i;
    while (/\\\s*$/.test(joined) && j + 1 < lines.length) {
      joined = joined.replace(/\\\s*$/, '');
      j++;
      const next = (lines[j] as string).trim();
      if (next.startsWith('#')) continue;
      joined += ' ' + next;
    }
    const m = /^(\w+)\s*(.*)$/s.exec(joined);
    if (m?.[1]) out.push({ line: i + 1, op: m[1].toUpperCase(), args: (m[2] ?? '').trim(), raw: joined });
    i = j;
  }
  return out;
}

function imageIssue(args: string, stages: Set<string>): boolean {
  const ref = args.split(/\s+/).filter((t) => !t.startsWith('--') && t.toLowerCase() !== 'as')[0] ?? '';
  if (ref === '' || ref === 'scratch' || stages.has(ref.toLowerCase()) || ref.includes('$') || ref.includes('@sha256:')) return false;
  const afterSlash = ref.slice(ref.lastIndexOf('/') + 1);
  const tag = afterSlash.includes(':') ? afterSlash.slice(afterSlash.indexOf(':') + 1) : '';
  return tag === '' || tag === 'latest';
}

/** Revisa un Dockerfile: imagen sin versión, usuario root, descargas sin verificar, secretos y permisos. */
export function checkDockerfile(text: string, file: string): Finding[] {
  const out: Finding[] = [];
  const ins = instructions(text);
  const stages = new Set<string>();
  let lastFrom: Instruction | undefined;
  let lastUser: Instruction | undefined;

  for (const i of ins) {
    if (i.op === 'FROM') {
      if (imageIssue(i.args, stages)) out.push(finding(R.latest, file, i.line, i.raw));
      const alias = /\sas\s+(\S+)\s*$/i.exec(i.args)?.[1];
      if (alias) stages.add(alias.toLowerCase());
      lastFrom = i;
      lastUser = undefined;
    } else if (i.op === 'USER') {
      lastUser = i;
    } else if (i.op === 'RUN') {
      if (/\b(?:curl|wget)\b[^|;&]*\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/.test(i.args)) out.push(finding(R.curlSh, file, i.line, i.raw));
      if (/\bchmod\s+(?:-R\s+)?(?:0?777|a\+rwx|ugo\+rwx)\b/.test(i.args)) out.push(finding(R.chmod, file, i.line, i.raw));
    } else if (i.op === 'ADD' && /^(?:--\S+\s+)*https?:\/\//i.test(i.args) && !/--checksum/i.test(i.args)) {
      out.push(finding(R.addUrl, file, i.line, i.raw));
    } else if (i.op === 'EXPOSE' && /(?:^|\s)22(?:\/tcp)?(?:\s|$)/.test(i.args)) {
      out.push(finding(R.ssh, file, i.line, i.raw));
    } else if (i.op === 'ENV' || i.op === 'ARG') {
      // Dos formas: `ENV A=1 B=2` y la antigua `ENV A 1`.
      const pairs: [string, string][] = [];
      if (/^[A-Za-z_]\w*\s*=/.test(i.args)) {
        for (const m of i.args.matchAll(/([A-Za-z_]\w*)=("[^"]*"|'[^']*'|\S*)/g)) pairs.push([m[1] as string, (m[2] as string).replace(/^["']|["']$/g, '')]);
      } else {
        const m = /^([A-Za-z_]\w*)\s+(.+)$/.exec(i.args);
        if (m) pairs.push([m[1] as string, (m[2] as string).replace(/^["']|["']$/g, '')]);
      }
      const secrets = pairs.filter(([name, value]) => SECRET_NAME.test(name) && value.length >= 6 && !value.includes('$') && !isPlaceholder(value));
      // Se enmascaran todos los valores de la instrucción, no solo el del hallazgo.
      const masked = secrets.reduce((acc, [, value]) => acc.split(value).join(maskSecret(value)), i.raw);
      for (const [name] of secrets) out.push(finding(R.secret, file, i.line, masked, ` (${name})`));
    }
  }

  if (lastFrom) {
    const root = lastUser === undefined || /^(?:root|0)(?::.*)?$/i.test(lastUser.args.trim());
    if (root) {
      const at = lastUser ?? lastFrom;
      out.push(finding(R.root, file, at.line, at.raw, lastUser ? '' : ' (no define USER)'));
    }
  }
  return out.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}

/** Revisa un docker-compose: contenedores privilegiados, red del host, socket de Docker e imágenes sin versión. */
export function checkCompose(text: string, file: string): Finding[] {
  const out: Finding[] = [];
  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.replace(/\s+#.*$/, '');
    const n = idx + 1;
    if (/^\s*privileged:\s*["']?true\b/i.test(line)) out.push(finding(R.privileged, file, n, raw));
    else if (/^\s*network_mode:\s*["']?host\b/i.test(line)) out.push(finding(R.hostNet, file, n, raw));
    else if (/\/var\/run\/docker\.sock/.test(line)) out.push(finding(R.sock, file, n, raw));
    else {
      const img = /^\s*image:\s*["']?([^\s"']+)/.exec(line)?.[1];
      if (img && !img.includes('$') && !img.includes('@sha256:')) {
        const afterSlash = img.slice(img.lastIndexOf('/') + 1);
        const tag = afterSlash.includes(':') ? afterSlash.slice(afterSlash.indexOf(':') + 1) : '';
        if (tag === '' || tag === 'latest') out.push(finding(R.composeLatest, file, n, raw));
      }
    }
  });
  return out;
}
