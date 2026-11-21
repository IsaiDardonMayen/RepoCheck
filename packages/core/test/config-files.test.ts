import { describe, expect, it } from 'vitest';
import { checkCompose, checkConfigFiles, redactSecrets, checkDockerfile, checkWorkflow, isConfigFile, selectKeyFiles } from '../src/index';

const ids = (fs: { ruleId: string }[]): string[] => fs.map((f) => f.ruleId);

describe('checkDockerfile', () => {
  it('un Dockerfile bien hecho no tiene hallazgos', () => {
    const d = ['FROM node:22.11-slim AS build', 'RUN npm ci', 'FROM gcr.io/distroless/nodejs22@sha256:abc', 'COPY --from=build /app /app', 'USER nonroot', 'CMD ["app.js"]'].join('\n');
    expect(checkDockerfile(d, 'Dockerfile')).toEqual([]);
  });

  it('marca imagen sin versión o latest, pero no etapas, scratch, digest ni variables', () => {
    const d = ['ARG V=1', 'FROM node AS a', 'FROM node:latest AS b', 'FROM a AS c', 'FROM scratch', 'FROM ubuntu@sha256:abc', 'FROM base:${V}', 'FROM localhost:5000/app', 'USER app'].join('\n');
    const r = checkDockerfile(d, 'Dockerfile').filter((f) => f.ruleId === 'DOCKER-LATEST-TAG');
    expect(r.map((f) => f.line)).toEqual([2, 3, 8]);
  });

  it('avisa del usuario root solo en la etapa final', () => {
    expect(ids(checkDockerfile('FROM node:22\nCMD ["x"]', 'Dockerfile'))).toEqual(['DOCKER-ROOT-USER']);
    expect(ids(checkDockerfile('FROM node:22\nUSER root\nCMD ["x"]', 'Dockerfile'))).toEqual(['DOCKER-ROOT-USER']);
    expect(checkDockerfile('FROM node:22 AS b\nFROM node:22\nUSER 1000:1000', 'Dockerfile')).toEqual([]);
    expect(ids(checkDockerfile('FROM node:22 AS b\nUSER app\nFROM node:22\nCMD x', 'Dockerfile'))).toEqual(['DOCKER-ROOT-USER']);
  });

  it('detecta curl|sh incluso en líneas continuadas, ADD remoto, chmod 777 y SSH', () => {
    const d = ['FROM node:22', 'RUN apt-get update && \\', '    curl -fsSL https://x.sh | bash', 'ADD https://x.com/a.tar /a', 'RUN chmod -R 777 /app', 'EXPOSE 8080 22', 'USER app'].join('\n');
    const r = checkDockerfile(d, 'Dockerfile');
    expect(ids(r)).toEqual(['DOCKER-CURL-PIPE-SH', 'DOCKER-ADD-URL', 'DOCKER-CHMOD-777', 'DOCKER-EXPOSE-SSH']);
    expect(r[0]?.line).toBe(2);
    expect(checkDockerfile('FROM node:22\nEXPOSE 2222\nUSER app', 'Dockerfile')).toEqual([]);
  });

  it('detecta secretos en ENV y ARG y los enmascara; ignora variables y marcadores', () => {
    const pw = 'Zx9' + 'qL2mP7vK4';
    const d = ['FROM node:22', `ENV DB_PASSWORD=${pw} MODE=prod`, `ARG API_TOKEN ${pw}`, 'ENV SECRET_KEY=${KEY}', 'ENV API_KEY=changeme', 'ENV PORT=8080', 'USER app'].join('\n');
    const r = checkDockerfile(d, 'Dockerfile').filter((f) => f.ruleId === 'DOCKER-SECRET-ENV');
    expect(r.map((f) => f.line)).toEqual([2, 3]);
    expect(r.every((f) => !f.snippet?.includes(pw) && f.severity === 'high')).toBe(true);
    expect(r[0]?.title).toContain('DB_PASSWORD');
  });
});

describe('privacidad en los fragmentos', () => {
  const a = 'AK' + 'IA' + 'Q7WXYZ4NB2MC5RTE';
  const b = 'k9Zq' + 'L2mP7vK4xN8wR3tY6uH1jD5fG0sA9cB2eV';
  const line = `ENV AWS_ACCESS_KEY="${a}" AWS_SECRET_KEY="${b}"`;

  it('un ENV con varios secretos no deja ninguno completo en ningún hallazgo', () => {
    const r = checkDockerfile(`FROM node:22\n${line}\nUSER app`, 'Dockerfile');
    expect(r.filter((f) => f.ruleId === 'DOCKER-SECRET-ENV')).toHaveLength(2);
    for (const f of r) {
      expect(f.snippet).not.toContain(a);
      expect(f.snippet).not.toContain(b);
    }
  });

  it('redactSecrets enmascara secretos de cualquier hallazgo, también de otros módulos', () => {
    const rules = [{ id: 'T', title: 't', severity: 'high' as const, pattern: '\\bAKIA[0-9A-Z]{16}\\b', fix: 'x' }];
    const out = redactSecrets(`RUN aws configure set key ${a} && echo ok`, rules);
    expect(out).not.toContain(a);
    expect(out).toContain('AKIA');
    const r = checkConfigFiles(new Map([['Dockerfile', `FROM node:22\nRUN aws s3 cp x --key ${a}\nUSER app`]]), { secretRules: rules });
    expect(r.findings.every((f) => !f.snippet?.includes(a))).toBe(true);
  });
});

describe('checkCompose', () => {
  it('detecta privileged, red del host, socket de Docker e imágenes sin versión', () => {
    const y = ['services:', '  a:', '    image: nginx', '    privileged: true', '  b:', '    image: redis:7.2', '    network_mode: "host"', '    volumes:', '      - /var/run/docker.sock:/var/run/docker.sock', '  c:', '    image: app:latest', '    image: ${IMG}'].join('\n');
    expect(checkCompose(y, 'docker-compose.yml').map((f) => `${f.line}:${f.ruleId}`)).toEqual(['3:COMPOSE-LATEST-TAG', '4:COMPOSE-PRIVILEGED', '7:COMPOSE-HOST-NETWORK', '9:COMPOSE-DOCKER-SOCKET', '11:COMPOSE-LATEST-TAG']);
  });
});

const wf = (body: string): string => `name: ci\non: [push]\npermissions:\n  contents: read\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n${body}`;

describe('checkWorkflow', () => {
  it('un workflow seguro no tiene hallazgos', () => {
    const sha = 'a'.repeat(40);
    expect(checkWorkflow(wf(`      - uses: owner/repo@${sha} # v1\n      - uses: ./local\n      - run: echo hola`), 'x.yml')).toEqual([]);
  });

  it('clasifica las acciones sin fijar según el riesgo', () => {
    const r = checkWorkflow(wf('      - uses: actions/checkout@v4\n      - uses: tercero/accion@v2.1.0\n      - uses: tercero/otra@main\n      - uses: tercero/sin-version'), 'x.yml');
    expect(r.map((f) => `${f.ruleId}:${f.severity}`)).toEqual(['WF-ACTION-OFFICIAL-TAG:low', 'WF-ACTION-NOT-PINNED:medium', 'WF-ACTION-BRANCH:high', 'WF-ACTION-BRANCH:high']);
  });

  it('avisa si no hay permisos o son write-all', () => {
    expect(ids(checkWorkflow('on: push\njobs: {}', 'x.yml'))).toEqual(['WF-NO-PERMISSIONS']);
    expect(ids(checkWorkflow('on: push\npermissions: write-all\njobs: {}', 'x.yml'))).toEqual(['WF-PERMISSIONS-WRITE-ALL']);
    expect(checkWorkflow('on: push\npermissions: {}\njobs: {}', 'x.yml')).toEqual([]);
  });

  it('detecta inyección de scripts solo dentro de run y script, no en env ni with', () => {
    const body = ['      - run: echo "${{ github.event.issue.title }}"', '      - run: |', '          echo ok', '          echo "${{ github.head_ref }}"', '      - name: seguro', '        env:', '          T: ${{ github.event.issue.title }}', '        run: echo "$T"', '      - uses: x/y@' + 'b'.repeat(40), '        with:', '          msg: ${{ github.event.pull_request.title }}'].join('\n');
    const r = checkWorkflow(wf(body), 'x.yml').filter((f) => f.ruleId === 'WF-SCRIPT-INJECTION');
    expect(r.map((f) => f.line)).toEqual([9, 12]);
  });

  it('detecta curl|sh y runners propios', () => {
    const r = checkWorkflow(wf('      - run: curl -sSL https://x.sh | sh').replace('ubuntu-latest', 'self-hosted'), 'x.yml');
    expect(ids(r).sort()).toEqual(['WF-CURL-PIPE-SH', 'WF-SELF-HOSTED']);
  });

  it('distingue pull_request_target simple del que ejecuta el código del PR', () => {
    const base = 'on:\n  pull_request_target:\npermissions: {}\njobs:\n  j:\n    runs-on: x\n    steps:\n';
    expect(checkWorkflow(base + '      - run: echo', 'x.yml').map((f) => `${f.ruleId}:${f.severity}`)).toEqual(['WF-PULL-REQUEST-TARGET:medium']);
    const r = checkWorkflow(base + '      - uses: actions/checkout@' + 'c'.repeat(40) + '\n        with:\n          ref: ${{ github.event.pull_request.head.sha }}', 'x.yml');
    expect(r.map((f) => `${f.ruleId}:${f.severity}`)).toEqual(['WF-PWN-REQUEST:critical']);
  });
});

describe('checkConfigFiles y selección de archivos', () => {
  it('aplica la revisión según el tipo de archivo y cuenta lo revisado', () => {
    const files = new Map([['app/Dockerfile.dev', 'FROM node'], ['compose.yaml', 'image: a'], ['.github/workflows/ci.yml', 'on: push'], ['README.md', 'x'], ['src/.github/workflows/no.yml', 'x']]);
    const r = checkConfigFiles(files);
    expect(r.checked).toEqual({ dockerfiles: 1, composeFiles: 1, workflows: 1 });
    expect(r.findings.every((f) => f.category === 'config')).toBe(true);
  });

  it('selectKeyFiles descarga también variantes de Dockerfile y compose', () => {
    const files = ['Dockerfile.prod', 'api.dockerfile', 'docker-compose.dev.yml', 'compose.yaml', 'notas.txt'].map((path) => ({ path, size: 1 }));
    expect(selectKeyFiles(files)).toEqual(['Dockerfile.prod', 'api.dockerfile', 'docker-compose.dev.yml', 'compose.yaml']);
    expect(isConfigFile('web/Dockerfile')).toBe(true);
    expect(isConfigFile('web/index.ts')).toBe(false);
  });
});
