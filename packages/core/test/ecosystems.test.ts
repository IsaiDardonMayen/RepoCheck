import { describe, expect, it } from 'vitest';
import {
  extractDependencies, parseCargoLock, parseComposerLock, parseGemfileLock, parseNuGet, parsePom, selectKeyFiles,
} from '../src/index';

const names = (deps: { name: string; version: string }[]): string[] => deps.map((d) => `${d.name}@${d.version}`);

describe('parsePom', () => {
  const pom = `<project>
    <parent><groupId>p</groupId><artifactId>p</artifactId><version>9.9.9</version></parent>
    <version>2.0.0</version>
    <properties><log4j.version>2.14.1</log4j.version></properties>
    <dependencies>
      <dependency><groupId>org.apache.logging.log4j</groupId><artifactId>log4j-core</artifactId><version>\${log4j.version}</version></dependency>
      <dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4.12</version><scope>test</scope></dependency>
      <dependency><groupId>a</groupId><artifactId>propia</artifactId><version>\${project.version}</version></dependency>
      <dependency><groupId>a</groupId><artifactId>sin-version</artifactId></dependency>
      <dependency><groupId>a</groupId><artifactId>rango</artifactId><version>[1.0,2.0)</version></dependency>
      <!-- <dependency><groupId>x</groupId><artifactId>comentada</artifactId><version>1.0</version></dependency> -->
    </dependencies></project>`;
  it('resuelve propiedades y la versión del proyecto, y cuenta lo que no puede resolver', () => {
    const r = parsePom(pom, 'pom.xml');
    expect(names(r.dependencies)).toEqual(['org.apache.logging.log4j:log4j-core@2.14.1', 'junit:junit@4.12', 'a:propia@2.0.0']);
    expect(r.unresolved).toBe(2);
  });
});

describe('parseCargoLock', () => {
  it('toma solo los paquetes de un registro', () => {
    const lock = `[[package]]\nname = "mi-app"\nversion = "0.1.0"\n\n[[package]]\nname = "smallvec"\nversion = "0.6.9"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "abc"\n`;
    expect(names(parseCargoLock(lock, 'Cargo.lock'))).toEqual(['smallvec@0.6.9']);
  });
});

describe('parseNuGet', () => {
  it('lee packages.lock.json y omite los proyectos', () => {
    const lock = JSON.stringify({ version: 1, dependencies: { 'net6.0': { 'Newtonsoft.Json': { type: 'Direct', resolved: '12.0.1' }, Mi: { type: 'Project' } } } });
    expect(names(parseNuGet(lock, 'packages.lock.json')?.dependencies ?? [])).toEqual(['Newtonsoft.Json@12.0.1']);
  });
  it('lee .csproj y packages.config, y cuenta versiones flotantes o en rango', () => {
    const cs = `<Project><ItemGroup><PackageReference Include="Serilog" Version="2.10.0" /><PackageReference Include="X" Version="1.*" /><PackageReference Include="Y" Version="[1.0,2.0)"/></ItemGroup></Project>`;
    const r = parseNuGet(cs, 'App.csproj');
    expect(names(r?.dependencies ?? [])).toEqual(['Serilog@2.10.0']);
    expect(r?.unresolved).toBe(2);
    expect(names(parseNuGet('<packages><package id="Old" version="1.2.3" targetFramework="net45" /></packages>', 'packages.config')?.dependencies ?? [])).toEqual(['Old@1.2.3']);
  });
  it('rechaza un lock que no es JSON válido', () => {
    expect(parseNuGet('{no', 'packages.lock.json')).toBeUndefined();
  });
});

describe('parseComposerLock', () => {
  it('lee packages y packages-dev, quita la v y pasa a minúsculas', () => {
    const lock = JSON.stringify({ packages: [{ name: 'Laravel/Framework', version: 'v5.5.0' }, { name: 'a/dev-branch', version: 'dev-main' }], 'packages-dev': [{ name: 'phpunit/phpunit', version: '9.5.0' }] });
    expect(names(parseComposerLock(lock, 'composer.lock') ?? [])).toEqual(['laravel/framework@5.5.0', 'phpunit/phpunit@9.5.0']);
  });
});

describe('parseGemfileLock', () => {
  it('lee solo las gemas de specs, sin sus dependencias, y quita el sufijo de plataforma', () => {
    const lock = ['GEM', '  remote: https://rubygems.org/', '  specs:', '    nokogiri (1.13.0-x86_64-linux)', '      racc (~> 1.4)', '    rails (5.0.0)', '      actionpack (= 5.0.0)', '', 'PLATFORMS', '  ruby', '', 'DEPENDENCIES', '  rails (= 5.0.0)'].join('\n');
    expect(names(parseGemfileLock(lock, 'Gemfile.lock'))).toEqual(['nokogiri@1.13.0', 'rails@5.0.0']);
  });
});

describe('extractDependencies con varios ecosistemas', () => {
  it('combina todo y avisa de Cargo.toml sin lock y de Gradle', () => {
    const files = new Map([
      ['Cargo.toml', '[package]'],
      ['svc/Cargo.toml', '[package]'],
      ['svc/Cargo.lock', '[[package]]\nname = "a"\nversion = "1.0.0"\nsource = "registry+x"\n'],
      ['build.gradle', 'dependencies {}'],
      ['Gemfile.lock', '  specs:\n    rake (13.0.6)\n'],
    ]);
    const r = extractDependencies(files);
    expect(r.dependencies.map((d) => d.ecosystem)).toEqual(['crates.io', 'RubyGems']);
    const notes = r.notes.join(' | ');
    expect(notes).toMatch(/^Cargo\.toml: sin Cargo\.lock|\| Cargo\.toml: sin Cargo\.lock|Cargo\.toml: sin Cargo\.lock/);
    expect(notes).not.toMatch(/svc\/Cargo\.toml: sin Cargo\.lock/);
    expect(notes).toMatch(/Gradle/);
  });
});

describe('selectKeyFiles', () => {
  it('incluye archivos .csproj y packages.config', () => {
    const files = ['src/App.csproj', 'packages.config', 'Gemfile.lock', 'x.cs'].map((path) => ({ path, size: 1 }));
    expect(selectKeyFiles(files)).toEqual(['src/App.csproj', 'packages.config', 'Gemfile.lock']);
  });
});
