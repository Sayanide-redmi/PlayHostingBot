const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');

// ── CONFIG ────────────────────────────────────────────────────────────────────
const CONFIG = {
  host: 'FlaireS5.play.hosting',
  port: 25565,
  username: 'IgnoreMe',       // change to whatever name you want
  password: 'qawsed1324',  // your /setpassword and /login password
  version: '1.21.11',

  useRandomInterval: true,
  staticInterval: 7 * 60 * 1000,
  minInterval: 6 * 60 * 1000,
  maxInterval: 8 * 60 * 1000,

  maxRetries: 5,
  sleepDuration: 30 * 60 * 1000,

  hitMessages: [
  ],

  registered: false,
};

// ── STATE ─────────────────────────────────────────────────────────────────────
let bot = null;
let retryCount = 0;
let sleeping = false;
let rejoinTimer = null;
let authDone = false;

// ── HELPERS ───────────────────────────────────────────────────────────────────
function randomHitMsg() {
  return CONFIG.hitMessages[Math.floor(Math.random() * CONFIG.hitMessages.length)];
}

function getInterval() {
  if (!CONFIG.useRandomInterval) return CONFIG.staticInterval;
  return Math.floor(
    Math.random() * (CONFIG.maxInterval - CONFIG.minInterval + 1) + CONFIG.minInterval
  );
}

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

// ── MAIN BOT CREATION ─────────────────────────────────────────────────────────
function createBot() {
  if (sleeping) return;

  log(`Connecting to ${CONFIG.host}...`);
  authDone = false;

  bot = mineflayer.createBot({
    host: CONFIG.host,
    port: CONFIG.port,
    username: CONFIG.username,
    version: CONFIG.version,
    auth: 'offline',
  });

  // ── SPAWN ────────────────────────────────────────────────────────────────
  bot.once('spawn', () => {
    log('Spawned. Waiting for auth prompt from server...');
    retryCount = 0;
    scheduleRejoin();

    // Fallback: if no chat prompt comes in 6 seconds, just send the command anyway
    setTimeout(() => {
      if (!authDone) {
        log('No prompt received — sending auth command anyway (fallback)...');
        sendAuth();
      }
    }, 6000);
  });

  // ── CHAT LISTENER FOR AUTH PROMPT ────────────────────────────────────────
  bot.on('message', (jsonMsg) => {
    const msg = jsonMsg.toString().toLowerCase();
    log(`Server message: ${msg}`);

    if (authDone) return;

    // SafeServer prompts contain these keywords
    if (msg.includes('setpassword') || msg.includes('set your password') || msg.includes('register')) {
      log('Got registration prompt.');
      sendAuth(true);
    } else if (msg.includes('login') || msg.includes('log in') || msg.includes('authenticate')) {
      log('Got login prompt.');
      sendAuth(false);
    }
  });

  // ── PATHFINDER SETUP ──────────────────────────────────────────────────────
  bot.loadPlugin(pathfinder);

  // ── AUTO RESPAWN ─────────────────────────────────────────────────────────
  bot.on('death', () => {
    log('Bot died. Respawning...');
    setTimeout(() => bot.respawn(), 1000);
  });

  // ── HIT DETECTION (say something when hit) ───────────────────────────────
  bot.on('entityHurt', (entity) => {
    if (entity === bot.entity) {
      const msg = randomHitMsg();
      log(`Bot was hit! Saying: "${msg}"`);
      bot.chat(msg);
    }
  });

  // ── COMBAT + MOVEMENT AI ─────────────────────────────────────────────────
  const HIT_RANGE       = 4;   // blocks — attack range
  const FLEE_RANGE      = 2.5; // blocks — too close, flee
  const SCAN_RANGE      = 6;   // blocks — detection radius
  const FLEE_DISTANCE   = 8;   // blocks — how far to flee to

  let combatTarget = null;
  let combatLoop   = null;

  function getNearestPlayer() {
    let nearest = null;
    let nearestDist = Infinity;
    const botPos = bot.entity.position;

    for (const entity of Object.values(bot.entities)) {
      if (entity === bot.entity) continue;
      if (entity.type !== 'player') continue;

      const dist = botPos.distanceTo(entity.position);
      if (dist < SCAN_RANGE && dist < nearestDist) {
        nearest = entity;
        nearestDist = dist;
      }
    }
    return { entity: nearest, dist: nearestDist };
  }

  function fleeFrom(entity) {
    const botPos  = bot.entity.position;
    const entPos  = entity.position;

    // direction AWAY from entity
    const dx = botPos.x - entPos.x;
    const dz = botPos.z - entPos.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;

    const fleeX = botPos.x + (dx / len) * FLEE_DISTANCE;
    const fleeZ = botPos.z + (dz / len) * FLEE_DISTANCE;

    // look opposite direction to entity
    const oppositeYaw = Math.atan2(dx, dz);
    bot.look(oppositeYaw, 0, true);

    const mcData   = require('minecraft-data')(bot.version);
    const movements = new Movements(bot, mcData);
    movements.canDig   = false;   // dont break blocks while fleeing
    movements.allowSprinting = true;
    bot.pathfinder.setMovements(movements);

    // GoalXZ just moves to a flat position — pathfinder handles jumps/gaps
    bot.pathfinder.setGoal(new goals.GoalXZ(fleeX, fleeZ), true);
    log(`Fleeing from ${entity.username} to (${fleeX.toFixed(1)}, ${fleeZ.toFixed(1)})`);
  }

  function attackEntity(entity) {
    bot.lookAt(entity.position.offset(0, entity.height, 0), true);
    bot.attack(entity);
  }

  function startCombatLoop() {
    if (combatLoop) return;
    log('Combat loop started.');

    combatLoop = setInterval(() => {
      try {
        const { entity, dist } = getNearestPlayer();

        if (!entity) {
          // nobody nearby — stop moving, chill
          combatTarget = null;
          bot.pathfinder.setGoal(null);
          bot.clearControlStates();
          return;
        }

        combatTarget = entity;

        if (dist <= FLEE_RANGE) {
          // TOO CLOSE — flee in opposite direction
          bot.setSprinting(true);
          fleeFrom(entity);

        } else if (dist <= HIT_RANGE) {
          // IN HIT RANGE — stop, look, punch
          bot.pathfinder.setGoal(null);
          bot.setSprinting(false);
          attackEntity(entity);

        } else if (dist <= SCAN_RANGE) {
          // DETECTED but out of range — do nothing, just watch
          bot.pathfinder.setGoal(null);
          bot.clearControlStates();
          bot.lookAt(entity.position.offset(0, entity.height, 0), true);
        }
      } catch (err) {
        // entity might have disappeared mid-tick
      }
    }, 200); // runs 5 times per second
  }

  function stopCombatLoop() {
    if (combatLoop) {
      clearInterval(combatLoop);
      combatLoop = null;
      log('Combat loop stopped.');
    }
  }

  bot.once('spawn', () => {
    // slight delay so pathfinder loads after world chunks arrive
    setTimeout(startCombatLoop, 3000);
  });

  bot.on('end', stopCombatLoop);
  bot.on('kicked', stopCombatLoop);

  // ── ERROR ────────────────────────────────────────────────────────────────
  bot.on('error', (err) => {
    log(`Error: ${err.message}`);
    handleDisconnect('error');
  });

  // ── KICKED ───────────────────────────────────────────────────────────────
  bot.on('kicked', (reason) => {
    log(`Kicked: ${reason}`);
    handleDisconnect('kicked');
  });

  // ── END ──────────────────────────────────────────────────────────────────
  bot.on('end', (reason) => {
    log(`Connection ended: ${reason}`);
    clearTimeout(rejoinTimer);
  });
}

// ── SEND AUTH COMMAND ─────────────────────────────────────────────────────────
function sendAuth(forceRegister) {
  authDone = true;

  // forceRegister = true  → definitely use /setpassword
  // forceRegister = false → definitely use /login
  // forceRegister = undefined → use CONFIG.registered to decide

  const shouldRegister = forceRegister !== undefined ? forceRegister : !CONFIG.registered;

  if (shouldRegister) {
    log('Sending /setpassword...');
    bot.chat(`/setpassword ${CONFIG.password} ${CONFIG.password}`);
    CONFIG.registered = true;
  } else {
    log('Sending /login...');
    bot.chat(`/login ${CONFIG.password}`);
  }
}

// ── DISCONNECT HANDLER ────────────────────────────────────────────────────────
function handleDisconnect(reason) {
  clearTimeout(rejoinTimer);

  if (reason === 'error' || reason === 'kicked') {
    retryCount++;
    log(`Retry ${retryCount}/${CONFIG.maxRetries}`);

    if (retryCount >= CONFIG.maxRetries) {
      log(`Max retries reached. Sleeping for ${CONFIG.sleepDuration / 60000} minutes...`);
      sleeping = true;
      setTimeout(() => {
        log('Waking up. Reconnecting...');
        sleeping = false;
        retryCount = 0;
        createBot();
      }, CONFIG.sleepDuration);
      return;
    }

    setTimeout(createBot, 15000);
  }
}

// ── REJOIN SCHEDULER ──────────────────────────────────────────────────────────
function scheduleRejoin() {
  const interval = getInterval();
  log(`Next rejoin in ${Math.round(interval / 60000)} min...`);

  rejoinTimer = setTimeout(() => {
    log('Scheduled rejoin...');
    retryCount = 0;
    bot.quit();
    setTimeout(createBot, 3000);
  }, interval);
}

// ── START ─────────────────────────────────────────────────────────────────────
createBot();
