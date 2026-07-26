const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const HIGH_OR_CRITICAL = new Set(['high', 'critical']);

function collectActiveExceptions(exceptions, now = new Date()) {
  if (!Array.isArray(exceptions)) {
    throw new Error('Dependency audit exceptions must be an array.');
  }
  const today = now.toISOString().slice(0, 10);
  const activeExceptions = new Map();

  for (const exception of exceptions) {
    if (
      !exception.advisory
      || !exception.owner
      || !exception.expires
      || !exception.remediation
      || !exception.reason
    ) {
      throw new Error(`Invalid dependency audit exception: ${JSON.stringify(exception)}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exception.expires)) {
      throw new Error(`Invalid dependency audit exception expiry: ${exception.expires}.`);
    }
    if (exception.expires < today) {
      throw new Error(`Dependency audit exception expired: ${exception.advisory} (${exception.expires}).`);
    }
    if (activeExceptions.has(exception.advisory)) {
      throw new Error(`Duplicate dependency audit exception: ${exception.advisory}.`);
    }
    activeExceptions.set(exception.advisory, exception);
  }

  return activeExceptions;
}

function loadActiveExceptions(now = new Date()) {
  const exceptionPath = path.join(__dirname, 'dependency-audit-exceptions.json');
  const { exceptions } = JSON.parse(fs.readFileSync(exceptionPath, 'utf8'));
  return collectActiveExceptions(exceptions, now);
}

function advisoryUrls(report, vulnerabilityName, ancestors = new Set()) {
  if (ancestors.has(vulnerabilityName)) {
    return [`unresolved:${vulnerabilityName}`];
  }

  const vulnerability = report.vulnerabilities[vulnerabilityName];
  if (!vulnerability) {
    return [`unresolved:${vulnerabilityName}`];
  }
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(vulnerabilityName);

  return vulnerability.via.flatMap((entry) => {
    if (typeof entry === 'string') {
      return advisoryUrls(report, entry, nextAncestors);
    }
    return entry.url ? [entry.url] : [`unresolved:${vulnerabilityName}`];
  });
}

function evaluateAuditReport(report, exceptions) {
  return Object.entries(report.vulnerabilities)
    .filter(([, vulnerability]) => HIGH_OR_CRITICAL.has(vulnerability.severity))
    .map(([name]) => ({
      name,
      advisories: [...new Set(advisoryUrls(report, name))],
    }))
    .filter((finding) => (
      finding.advisories.length === 0
      || finding.advisories.some((advisory) => !exceptions.has(advisory))
    ));
}

function runAudit(args) {
  const npmCli = process.env.npm_execpath;
  const command = npmCli
    ? process.execPath
    : process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const commandArgs = npmCli
    ? [npmCli, 'audit', '--json', ...args]
    : ['audit', '--json', ...args];
  const result = spawnSync(command, commandArgs, { encoding: 'utf8' });

  if (result.error) {
    throw result.error;
  }
  if (!result.stdout) {
    throw new Error(`npm audit did not return a JSON report: ${result.stderr}`);
  }

  return JSON.parse(result.stdout);
}

function printFindings(scope, findings) {
  for (const finding of findings) {
    console.error(`${scope} dependency audit finding: ${finding.name}`);
    for (const advisory of finding.advisories) {
      console.error(`  ${advisory}`);
    }
  }
}

function main() {
  const exceptions = loadActiveExceptions();
  const productionFindings = evaluateAuditReport(runAudit(['--omit=dev']), new Map());
  const allFindings = evaluateAuditReport(runAudit([]), exceptions);

  if (productionFindings.length > 0 || allFindings.length > 0) {
    printFindings('Production', productionFindings);
    printFindings('Full', allFindings);
    process.exitCode = 1;
    return;
  }

  console.log(`Dependency audit passed with ${exceptions.size} active, expiring development-only exception(s).`);
}

if (require.main === module) {
  main();
}

module.exports = {
  advisoryUrls,
  collectActiveExceptions,
  evaluateAuditReport,
  loadActiveExceptions,
  printFindings,
};
