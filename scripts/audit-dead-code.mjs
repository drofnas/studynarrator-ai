#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".css"]);
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".tmp",
  "coverage",
  "dist",
  "graphify-out",
  "node_modules",
  "playwright-report",
  "test-results",
]);
const ENTRYPOINT_BASENAMES = new Set([
  "apiManifest.ts",
  "bridgeManifest.ts",
  "cli.ts",
  "index.ts",
  "main.ts",
  "main.tsx",
  "migrate.ts",
  "preload.ts",
  "serviceManifest.ts",
  "smoke.ts",
  "vite-env.d.ts",
]);
const SCRIPT_BINARIES = new Map([
  ["concurrently", "concurrently"],
  ["electron", "electron"],
  ["eslint", "eslint"],
  ["playwright", "@playwright/test"],
  ["prettier", "prettier"],
  ["tsc", "typescript"],
  ["tsx", "tsx"],
  ["vite", "vite"],
  ["vitest", "vitest"],
  ["wait-on", "wait-on"],
]);

function unixPath(path) {
  return path.replaceAll("\\", "/");
}

function walk(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return files;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function packageName(specifier) {
  if (
    !specifier ||
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("node:")
  )
    return null;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function scriptKind(path) {
  return path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function moduleSpecifiers(path, text) {
  const specifiers = [];
  if (path.endsWith(".css")) {
    for (const match of text.matchAll(
      /@import\s+(?:url\()?\s*["']([^"']+)["']/gu,
    ))
      specifiers.push(match[1]);
    return specifiers;
  }
  if (!CODE_EXTENSIONS.has(extname(path))) return specifiers;
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(path),
  );
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const first = node.arguments[0];
      if (
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require")) &&
        first &&
        ts.isStringLiteral(first)
      )
        specifiers.push(first.text);
    } else if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "URL"
    ) {
      const first = node.arguments?.[0];
      if (first && ts.isStringLiteral(first)) specifiers.push(first.text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      specifiers.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

function packageExportTargets(manifest) {
  const targets = [];
  const collect = (value) => {
    if (typeof value === "string") targets.push(value);
    else if (value && typeof value === "object")
      Object.values(value).forEach(collect);
  };
  collect(manifest.exports);
  if (typeof manifest.types === "string") targets.push(manifest.types);
  return targets;
}

function candidatePaths(base) {
  const extension = extname(base);
  const withoutCompiledExtension = /\.(?:c|m)?js$/u.test(extension)
    ? base.slice(0, -extension.length)
    : base;
  return [
    base,
    `${withoutCompiledExtension}.ts`,
    `${withoutCompiledExtension}.tsx`,
    `${withoutCompiledExtension}.css`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
}

function resolveExisting(base, sourceFiles) {
  return (
    candidatePaths(base)
      .map((candidate) => resolve(candidate))
      .find((candidate) => sourceFiles.has(candidate)) ?? null
  );
}

function workspacePackages(allFiles) {
  const result = new Map();
  for (const path of allFiles.filter((file) => file.endsWith("package.json"))) {
    const manifest = readJson(path);
    if (typeof manifest.name === "string")
      result.set(manifest.name, { directory: dirname(path), manifest, path });
  }
  return result;
}

function resolveModule(fromFile, specifier, context) {
  if (specifier.startsWith("@/")) {
    return resolveExisting(
      join(context.root, "apps/web/src", specifier.slice(2)),
      context.sourceFiles,
    );
  }
  if (specifier.startsWith("."))
    return resolveExisting(
      join(dirname(fromFile), specifier),
      context.sourceFiles,
    );
  const dependency = packageName(specifier);
  const workspace = dependency ? context.packages.get(dependency) : undefined;
  if (!workspace) return null;
  const subpath =
    specifier === dependency ? "." : `.${specifier.slice(dependency.length)}`;
  const exports = workspace.manifest.exports;
  let target;
  if (typeof exports === "string" && subpath === ".") target = exports;
  else if (exports && typeof exports === "object") {
    const value = exports[subpath];
    target =
      typeof value === "string"
        ? value
        : (value?.types ?? value?.import ?? value?.default);
  }
  target ??= workspace.manifest.types;
  return typeof target === "string"
    ? resolveExisting(join(workspace.directory, target), context.sourceFiles)
    : null;
}

function entrypoints(context) {
  const roots = new Set();
  for (const file of context.sourceFiles) {
    const name = file.slice(file.lastIndexOf("/") + 1);
    const relativePath = unixPath(relative(context.root, file));
    if (
      ENTRYPOINT_BASENAMES.has(name) ||
      /(?:^|\/)(?:scripts|workers)\//u.test(relativePath) ||
      /(?:^|\/)\w+\.worker\.[^.]+$/u.test(relativePath) ||
      /(?:^|\/)[^/]*manifest[^/]*\.ts$/iu.test(relativePath) ||
      /\.(?:test|spec)\.tsx?$/u.test(relativePath) ||
      /(?:^|\/)[^/]+\.config\.ts$/u.test(relativePath) ||
      file.endsWith(".d.ts")
    )
      roots.add(file);
  }
  for (const { directory, manifest } of context.packages.values()) {
    for (const target of packageExportTargets(manifest)) {
      const resolved = resolveExisting(
        join(directory, target),
        context.sourceFiles,
      );
      if (resolved) roots.add(resolved);
    }
    for (const command of Object.values(manifest.scripts ?? {})) {
      if (typeof command !== "string") continue;
      for (const match of command.matchAll(
        /(?:^|\s)([^\s"']+\.tsx?)(?=\s|$)/gu,
      )) {
        const resolved = resolveExisting(
          join(directory, match[1]),
          context.sourceFiles,
        );
        if (resolved) roots.add(resolved);
      }
    }
  }
  for (const file of context.allFiles.filter(
    (candidate) => !context.sourceFiles.has(candidate),
  )) {
    if (!CODE_EXTENSIONS.has(extname(file)) && !file.endsWith("package.json"))
      continue;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/["']([^"']+\.tsx?)["']/gu)) {
      const resolved = resolveExisting(
        join(dirname(file), match[1]),
        context.sourceFiles,
      );
      if (resolved) roots.add(resolved);
    }
  }
  return roots;
}

function reachableFiles(context) {
  const reachable = new Set();
  const pending = [...entrypoints(context)];
  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || reachable.has(file)) continue;
    reachable.add(file);
    const text = readFileSync(file, "utf8");
    for (const specifier of moduleSpecifiers(file, text)) {
      const target = resolveModule(file, specifier, context);
      if (target && !reachable.has(target)) pending.push(target);
    }
  }
  return reachable;
}

function identifierNames(name) {
  if (ts.isIdentifier(name)) return [name.text];
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    return name.elements.flatMap((element) =>
      ts.isBindingElement(element) ? identifierNames(element.name) : [],
    );
  }
  return [];
}

function hasModifier(node, kind) {
  return node.modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

function exportIndex(context, reachable) {
  const modules = new Map();
  const candidates = new Map();
  const addCandidate = (file, name, line, kind) => {
    const key = `${file}\u0000${name}`;
    candidates.set(key, { key, file, name, line, kind });
    return key;
  };
  for (const file of [...reachable].filter(
    (path) => /\.tsx?$/u.test(path) && !path.endsWith(".d.ts"),
  )) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      scriptKind(file),
    );
    const module = { direct: new Map(), named: new Map(), stars: [], source };
    for (const statement of source.statements) {
      if (
        hasModifier(statement, ts.SyntaxKind.ExportKeyword) &&
        !hasModifier(statement, ts.SyntaxKind.DefaultKeyword)
      ) {
        let names = [];
        if (ts.isVariableStatement(statement))
          names = statement.declarationList.declarations.flatMap(({ name }) =>
            identifierNames(name),
          );
        else if (
          (ts.isFunctionDeclaration(statement) ||
            ts.isClassDeclaration(statement) ||
            ts.isInterfaceDeclaration(statement) ||
            ts.isTypeAliasDeclaration(statement) ||
            ts.isEnumDeclaration(statement)) &&
          statement.name
        )
          names = [statement.name.text];
        for (const name of names) {
          module.direct.set(
            name,
            addCandidate(
              file,
              name,
              source.getLineAndCharacterOfPosition(statement.getStart()).line +
                1,
              "declaration",
            ),
          );
        }
      }
      if (!ts.isExportDeclaration(statement)) continue;
      const target =
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier)
          ? resolveModule(file, statement.moduleSpecifier.text, context)
          : null;
      if (!statement.exportClause) {
        if (target) module.stars.push(target);
        continue;
      }
      if (ts.isNamespaceExport(statement.exportClause)) {
        const name = statement.exportClause.name.text;
        module.named.set(name, { key: null, target, imported: "*" });
        continue;
      }
      for (const element of statement.exportClause.elements) {
        const name = element.name.text;
        module.named.set(name, {
          key: target
            ? null
            : addCandidate(
                file,
                name,
                source.getLineAndCharacterOfPosition(element.getStart()).line +
                  1,
                "alias",
              ),
          target,
          imported: element.propertyName?.text ?? name,
        });
      }
    }
    modules.set(file, module);
  }
  return { modules, candidates };
}

function usedExports(context, reachable, index) {
  const used = new Set();
  const resolveExport = (file, name, seen = new Set()) => {
    const marker = `${file}\u0000${name}`;
    if (seen.has(marker)) return [];
    seen.add(marker);
    const module = index.modules.get(file);
    if (!module) return [];
    if (module.direct.has(name)) return [module.direct.get(name)];
    const named = module.named.get(name);
    if (named) {
      if (!named.target || named.imported === "*")
        return named.key ? [named.key] : [];
      return resolveExport(named.target, named.imported, seen);
    }
    return module.stars.flatMap((target) =>
      resolveExport(target, name, new Set(seen)),
    );
  };
  const allNames = (file, seen = new Set()) => {
    if (seen.has(file)) return [];
    seen.add(file);
    const module = index.modules.get(file);
    if (!module) return [];
    return [
      ...module.direct.keys(),
      ...module.named.keys(),
      ...module.stars.flatMap((target) => allNames(target, seen)),
    ];
  };
  for (const [file, module] of index.modules) {
    for (const statement of module.source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !statement.importClause ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      )
        continue;
      const target = resolveModule(
        file,
        statement.moduleSpecifier.text,
        context,
      );
      if (!target) continue;
      const bindings = statement.importClause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          for (const key of resolveExport(
            target,
            element.propertyName?.text ?? element.name.text,
          ))
            used.add(key);
        }
      } else if (bindings && ts.isNamespaceImport(bindings)) {
        for (const name of allNames(target))
          for (const key of resolveExport(target, name)) used.add(key);
      }
    }
  }
  return used;
}

function usedPackages(files) {
  const used = new Set();
  for (const file of files.filter((path) =>
    CODE_EXTENSIONS.has(extname(path)),
  )) {
    const text = readFileSync(file, "utf8");
    for (const specifier of moduleSpecifiers(file, text)) {
      const dependency = packageName(specifier);
      if (dependency) used.add(dependency);
    }
    if (text.includes("@vitest-environment jsdom")) used.add("jsdom");
  }
  return used;
}

function dependencyFailures(context) {
  const failures = [];
  const rootPackagePath = join(context.root, "package.json");
  for (const { directory, manifest, path } of context.packages.values()) {
    const scope =
      path === rootPackagePath
        ? context.allFiles
        : context.allFiles.filter((file) => file.startsWith(`${directory}/`));
    const used = usedPackages(scope);
    const scriptManifests =
      path === rootPackagePath
        ? [...context.packages.values()].map((item) => item.manifest)
        : [manifest];
    const scripts = scriptManifests
      .flatMap((item) => Object.values(item.scripts ?? {}))
      .filter((value) => typeof value === "string")
      .join(" ");
    for (const [binary, dependency] of SCRIPT_BINARIES)
      if (scripts.includes(binary)) used.add(dependency);
    if (scope.some((file) => /\.(?:test|spec)\.tsx?$/u.test(file)))
      used.add("vitest");
    if (scope.some((file) => file.endsWith(".tsx"))) {
      used.add("react");
      used.add("@types/react");
      used.add("@types/react-dom");
    }
    if (scope.some((file) => /\.tsx?$/u.test(file))) used.add("@types/node");
    for (const dependency of Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    })) {
      const underlying = dependency.startsWith("@types/")
        ? dependency.slice(7).replace("__", "/")
        : null;
      if (used.has(dependency) || (underlying && used.has(underlying)))
        continue;
      failures.push({
        code: "unused-dependency",
        file: unixPath(relative(context.root, path)),
        name: dependency,
        message: `declared dependency ${dependency} is unused`,
      });
    }
  }
  return failures;
}

export function auditRepository(rootDirectory) {
  const root = resolve(rootDirectory);
  const allFiles = walk(root).map((path) => resolve(path));
  const sourceFiles = new Set(
    allFiles.filter((path) => SOURCE_EXTENSIONS.has(extname(path))),
  );
  const context = {
    root,
    allFiles,
    sourceFiles,
    packages: workspacePackages(allFiles),
  };
  const reachable = reachableFiles(context);
  const failures = [];
  for (const file of sourceFiles) {
    if (!reachable.has(file))
      failures.push({
        code: "unreachable-file",
        file: unixPath(relative(root, file)),
        name: null,
        message: "source file is unreachable",
      });
  }
  const index = exportIndex(context, reachable);
  const used = usedExports(context, reachable, index);
  for (const candidate of index.candidates.values()) {
    if (used.has(candidate.key)) continue;
    failures.push({
      code: "unused-export",
      file: unixPath(relative(root, candidate.file)),
      name: candidate.name,
      line: candidate.line,
      message: `export ${candidate.name} is unused outside its module`,
    });
  }
  failures.push(...dependencyFailures(context));
  return failures.sort((left, right) =>
    `${left.file}:${String(left.line ?? 0)}:${left.code}:${left.name ?? ""}`.localeCompare(
      `${right.file}:${String(right.line ?? 0)}:${right.code}:${right.name ?? ""}`,
    ),
  );
}

function runCli() {
  const rootArgument = process.argv.indexOf("--root");
  const root =
    rootArgument === -1
      ? resolve(import.meta.dirname, "..")
      : resolve(process.argv[rootArgument + 1] ?? "");
  const failures = auditRepository(root);
  if (failures.length > 0) {
    process.stderr.write(
      `DEAD CODE AUDIT: ERROR: found ${String(failures.length)} issue(s)\n`,
    );
    for (const failure of failures) {
      process.stderr.write(
        `${failure.file}${failure.line ? `:${String(failure.line)}` : ""}: ${failure.code}: ${failure.name ? `${failure.name}: ` : ""}${failure.message}\n`,
      );
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write("DEAD CODE AUDIT: PASSED\n");
}

const invokedPath =
  process.argv[1] && isAbsolute(process.argv[1])
    ? process.argv[1]
    : resolve(process.argv[1] ?? "");
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) runCli();
