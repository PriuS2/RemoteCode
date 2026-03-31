const fs = require("node:fs");
const path = require("node:path");

function readPackageVersion() {
  try {
    const packageJsonPath = path.join(__dirname, "..", "package.json");
    const raw = fs.readFileSync(packageJsonPath, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.version === "string" && parsed.version.trim()) {
      return parsed.version.trim();
    }
  } catch {
    // Ignore package.json read failures and fall back below.
  }
  return "1.0.0";
}

function normalizeBuildVersion(buildVersion, fallbackVersion = readPackageVersion()) {
  const raw = typeof buildVersion === "string" && buildVersion.trim() ? buildVersion.trim() : "dev";
  const stripped = raw.startsWith("v") ? raw.slice(1) : raw;

  if (/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(stripped)) {
    return stripped;
  }

  if (raw === "dev") {
    return `${fallbackVersion}-dev`;
  }

  const sanitized = stripped
    .toLowerCase()
    .replace(/[^0-9a-z.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return `${fallbackVersion}-${sanitized || "dev"}`;
}

function buildDownloadUrl(repository, tagName, assetName) {
  if (!repository || !tagName || !assetName) {
    return "";
  }
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tagName)}/${encodeURIComponent(assetName)}`;
}

function buildManifest({
  version,
  minimumSupportedVersion,
  platform,
  arch,
  assetName,
  tagName,
  repository,
  publishedAt,
}) {
  return {
    version,
    minimumSupportedVersion: minimumSupportedVersion || version,
    platform,
    arch,
    assetName,
    downloadUrl: buildDownloadUrl(repository, tagName, assetName),
    publishedAt: publishedAt || new Date().toISOString(),
  };
}

function writeJson(outputPath, data) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(data, null, 2)}\n`);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--print-version") {
      args.printVersion = true;
      continue;
    }
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (typeof value === "undefined" || value.startsWith("--")) {
      args[key] = "";
      continue;
    }
    args[key] = value;
    index += 1;
  }
  return args;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const buildVersion = args["build-version"] || process.env.BUILD_VERSION || "dev";
  const normalizedVersion = normalizeBuildVersion(buildVersion);

  if (args.printVersion) {
    process.stdout.write(normalizedVersion);
    process.exit(0);
  }

  const manifest = buildManifest({
    version: args["current-version"] || normalizedVersion,
    minimumSupportedVersion: args["minimum-supported-version"] || normalizedVersion,
    platform: args.platform || process.platform,
    arch: args.arch || process.arch,
    assetName: args["asset-name"] || "",
    tagName: args.tag || buildVersion,
    repository: args.repository || process.env.GITHUB_REPOSITORY || process.env.RELEASE_REPOSITORY || "",
    publishedAt: args["published-at"] || process.env.BUILD_PUBLISHED_AT || new Date().toISOString(),
  });

  if (!args.output) {
    throw new Error("--output is required unless --print-version is used.");
  }

  writeJson(args.output, manifest);
  if (args["release-output"]) {
    writeJson(args["release-output"], manifest);
  }
}

module.exports = {
  buildManifest,
  normalizeBuildVersion,
};
