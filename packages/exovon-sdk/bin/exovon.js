#!/usr/bin/env node

const { ExovonClient } = require('../dist/index.js');
const path = require('path');

const HELP_TEXT = `
  ⚡ Exovon CLI — Deploy to the Edge in seconds.

  USAGE:
    npx exovon deploy [options]

  DEPLOYMENT TYPE FLAGS (optional — auto-detected if omitted):
    --static          Force Fast-Path deployment (static HTML/CSS/JS, 0s Cloud Build)
    --dynamic         Force Cloud Build pipeline (Next.js, Node, Docker, SSR)
    --framework <fw>  Specify framework explicitly: static, nextjs, vite, astro, nuxt, remix, docker

  OPTIONS:
    --project <id>         (required) Target project name
    --source-dir <path>    Source directory to deploy (default: current directory)
    --build-command <cmd>  Custom build command (default: npm run build)
    --output-dir <dir>     Build output directory (default: dist)
    --help                 Show this help message

  EXAMPLES:
    npx exovon deploy --static --project my-landing-page
    npx exovon deploy --dynamic --project my-nextjs-app
    npx exovon deploy --framework nextjs --project my-app
    npx exovon deploy --project my-app   (auto-detects type)

  SECRETS MANAGEMENT:
    npx exovon env add <key> <value> --project <id>
    npx exovon env ls --project <id>
    npx exovon env rm <key> --project <id>
    npx exovon env pull [filename] --project <id>
`;


async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // Handle --help anywhere in args
  if (args.includes('--help') || args.includes('-h') || !command) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  if (command !== 'deploy' && command !== 'env') {
    console.error(`Unknown command: ${command}`);
    console.log(HELP_TEXT);
    process.exit(1);
  }

  const apiKey = process.env.EXOVON_API_KEY;
  if (!apiKey) {
    console.error('ERROR: EXOVON_API_KEY environment variable is missing.');
    console.error('Please set EXOVON_API_KEY before running the Exovon CLI.');
    process.exit(1);
  }

  const client = new ExovonClient({ apiKey });

  if (command === 'env') {
    await handleEnvCommand(client, args.slice(1));
    return;
  }

  // Parse arguments
  let projectId = '';
  let buildCommand = 'npm run build';
  let outputDir = 'dist';
  let sourceDir = process.cwd();
  let forceStatic = false;
  let forceDynamic = false;
  let framework = '';

  for (let i = 1; i < args.length; i++) {
    switch (args[i]) {
      case '--project':       projectId = args[++i]; break;
      case '--build-command': buildCommand = args[++i]; break;
      case '--output-dir':    outputDir = args[++i]; break;
      case '--source-dir':    sourceDir = args[++i]; break;
      case '--static':        forceStatic = true; break;
      case '--dynamic':       forceDynamic = true; break;
      case '--framework':     framework = (args[++i] || '').toLowerCase(); break;
    }
  }

  if (!projectId) {
    console.error('ERROR: --project argument is required.');
    console.log(HELP_TEXT);
    process.exit(1);
  }

  if (forceStatic && forceDynamic) {
    console.error('ERROR: Cannot use both --static and --dynamic. Choose one.');
    process.exit(1);
  }

  // Resolve deployment type
  let deployType = 'auto'; // auto-detect by default
  if (forceStatic || framework === 'static') {
    deployType = 'static';
  } else if (forceDynamic || ['nextjs', 'vite', 'astro', 'nuxt', 'remix', 'docker'].includes(framework)) {
    deployType = 'dynamic';
  }

  try {
    const typeLabel = deployType === 'static' ? '⚡ STATIC (Fast-Path)'
                    : deployType === 'dynamic' ? '🛠️  DYNAMIC (Cloud Build)'
                    : '🤖 AUTO-DETECT';

    console.log(`🚀 Starting deployment for project: ${projectId}`);
    console.log(`   Mode: ${typeLabel}`);
    if (framework) console.log(`   Framework: ${framework}`);
    console.log('');

    const deployOptions = {
      projectId,
      sourceDir,
      buildCommand,
      outputDir,
      framework: framework || undefined,
    };

    // If user explicitly chose --static, override isPrebuilt to true
    if (deployType === 'static') {
      deployOptions.isPrebuilt = true;
    } else if (deployType === 'dynamic') {
      deployOptions.isPrebuilt = false;
    }
    // If 'auto', let the SDK's isPrebuiltProject() auto-detect

    const { deployId, buildId, fastPath, url } = await client.deployments.deploy(
      deployOptions,
      (step) => {
        console.log(`[Deploy] ${step}`);
      }
    );

    if (fastPath) {
      console.log(`\n⚡ FAST-PATH SUCCESS: Static site promoted to Edge CDN in < 1s!`);
      console.log(`   Zero Cloud Build containers launched.`);
      console.log(`   URL: ${url || `https://${projectId}.exovon.co.in`}`);
      return;
    }

    console.log(`✅ Deployment initiated successfully!`);
    console.log(`   Deploy ID: ${deployId}`);
    
    console.log(`\nStreaming build logs...\n`);
    const pollRes = await client.deployments.pollLogs(deployId, (logLine) => {
      process.stdout.write(logLine);
    });

    if (pollRes.success) {
      console.log(`\n\n✅ Deployment completed successfully!`);
      console.log(`   URL: ${url || `https://${projectId}.exovon.co.in`}`);
    } else {
      console.error(`\n\n❌ Deployment failed with status: ${pollRes.finalStatus}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`\n❌ Deployment failed:`, error.message);
    process.exit(1);
  }
}

async function handleEnvCommand(client, args) {
  const subCommand = args[0];
  let projectId = '';
  
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--project') {
      projectId = args[i + 1];
      break;
    }
  }

  if (!projectId) {
    console.error('ERROR: --project argument is required for env commands.');
    process.exit(1);
  }

  try {
    if (subCommand === 'ls') {
      console.log(`\n🔑 Fetching secrets for project: ${projectId}...`);
      const { keys } = await client.secrets.listKeys(projectId);
      if (!keys || keys.length === 0) {
        console.log('   No environment variables configured.');
      } else {
        console.log(`   Found ${keys.length} variable(s):`);
        keys.forEach(k => console.log(`   - ${k}: ********`));
      }
    } 
    else if (subCommand === 'add') {
      const key = args[1];
      const value = args[2];
      if (!key || !value || key === '--project') {
        console.error('ERROR: Usage: exovon env add <key> <value> --project <id>');
        process.exit(1);
      }
      console.log(`\n🔒 Adding secret ${key} to project: ${projectId}...`);
      await client.secrets.update(projectId, { [key]: value });
      console.log(`✅ Secret ${key} successfully added! Redeploy for changes to take effect.`);
    }
    else if (subCommand === 'rm') {
      const key = args[1];
      if (!key || key === '--project') {
        console.error('ERROR: Usage: exovon env rm <key> --project <id>');
        process.exit(1);
      }
      console.log(`\n🗑️ Removing secret ${key} from project: ${projectId}...`);
      await client.secrets.delete(projectId, key);
      console.log(`✅ Secret ${key} successfully removed! Redeploy for changes to take effect.`);
    }
    else if (subCommand === 'pull') {
      const fs = require('fs');
      let filename = '.env.local';
      if (args[1] && args[1] !== '--project') {
        filename = args[1];
      }
      console.log(`\n📥 Pulling secrets for project: ${projectId} into ${filename}...`);
      const { secrets } = await client.secrets.pull(projectId);
      if (!secrets || Object.keys(secrets).length === 0) {
        console.log('   No environment variables configured to pull.');
        return;
      }
      let content = '';
      for (const [k, v] of Object.entries(secrets)) {
        content += `${k}="${v.replace(/"/g, '\\"')}"\n`;
      }
      fs.writeFileSync(path.join(process.cwd(), filename), content);
      console.log(`✅ Successfully wrote ${Object.keys(secrets).length} variables to ${filename}`);
    }
    else {
      console.error(`Unknown env command: ${subCommand}`);
      console.log('Available commands: add, ls, rm, pull');
      process.exit(1);
    }
  } catch (err) {
    console.error(`\n❌ Secret operation failed:`, err.message);
    process.exit(1);
  }
}

main();
