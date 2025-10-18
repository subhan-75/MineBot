// bot.js
// Dependencies
const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals: { GoalNear } } = require('mineflayer-pathfinder');
const autoeat = require('mineflayer-auto-eat');
const Vec3 = require('vec3');

// CONFIG - intentionally left blank for GitHub. Fill before running or use env vars.
const HOST = process.env.HOST || '';      // <-- PUT SERVER IP / HOST HERE (leave blank in repo)
const PORT = parseInt(process.env.PORT || '') || undefined; // <-- PUT PORT here or leave undefined
const USERNAME = process.env.USERNAME || 'AFKBot_Subhan'; // change if you want
const VERSION = process.env.VERSION || false; // set MC version like '1.20.4' if needed

// Movement / behavior settings
const FORWARD_INTERVAL = 1000; // ms - how often we ensure forward pressed
const JUMP_INTERVAL = 600;     // ms - jump toggling interval
const CHAT_INTERVAL = 60 * 1000; // 1 minute
const RECONNECT_DELAY = 3000; // ms before attempting reconnect after 'end' or error
const ITEM_PICKUP_RANGE = 6; // blocks to consider picking up

// We'll create a factory so bot can be re-created on disconnect
let bot = null;
let forwardIntervalId = null;
let jumpIntervalId = null;
let chatIntervalId = null;
let tryingToPickup = false;

function createBot() {
  console.log('Creating bot...');

  bot = mineflayer.createBot({
    host: HOST,            // intentionally blank in repo
    port: PORT,            // undefined if not provided
    username: USERNAME,
    version: VERSION || false, // false auto-detects server version
  });

  // load plugins
  bot.loadPlugin(pathfinder);
  bot.loadPlugin(autoeat);

  // Setup auto-eat
  bot.once('spawn', () => {
    try {
      bot.autoEat.options = {
        priority: 'saturation', // or 'foodPoints'
        startAt: 14, // start eating when hunger <= 14 (out of 20)
      };
      bot.autoEat.enable();
    } catch (e) {
      console.warn('AutoEat setup failed:', e);
    }
  });

  // On spawn: start movement and chat loop
  bot.on('spawn', () => {
    console.log('Spawned into the world. Starting AFK movement and chat.');

    // Ensure pathfinder movements exist
    const defaultMove = new Movements(bot);
    bot.pathfinder.setMovements(defaultMove);

    // Make bot move forward continuously
    if (forwardIntervalId) clearInterval(forwardIntervalId);
    forwardIntervalId = setInterval(() => {
      if (!bot.entity) return;
      // make sure we are pressing forward
      bot.setControlState('forward', true);
    }, FORWARD_INTERVAL);

    // Jump periodically to simulate AFK jumping-run
    if (jumpIntervalId) clearInterval(jumpIntervalId);
    jumpIntervalId = setInterval(() => {
      // toggle jump briefly
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), 120);
    }, JUMP_INTERVAL);

    // Chat message every 1 minute
    if (chatIntervalId) clearInterval(chatIntervalId);
    chatIntervalId = setInterval(() => {
      if (bot && bot.chat) {
        try {
          bot.chat('Subhan is the King');
        } catch (e) { /* ignore */ }
      }
    }, CHAT_INTERVAL);
  });

  // Handle death -> bot will get 'spawn' event when respawned automatically by server.
  bot.on('death', () => {
    console.log('I died. Waiting to respawn...');
    // stop movement while dead
    bot.clearControlStates && bot.clearControlStates();
  });

  // If we detect nearby item entities (dropped items), try to pick them up if they are food
  bot.on('entitySpawn', (entity) => {
    tryPickupItem(entity);
  });

  // Also scan periodically for nearby dropped food items
  const scanInterval = setInterval(() => {
    if (!bot || !bot.entity) return;
    const items = Object.values(bot.entities).filter(e => e?.objectType === 'Item' || e?.type === 'object' || e?.name === 'item');
    for (const item of items) {
      if (!item || !item.position) continue;
      const dist = bot.entity.position.distanceTo(item.position);
      if (dist <= ITEM_PICKUP_RANGE) {
        tryPickupItem(item);
        break;
      }
    }
  }, 2000);

  // Utility: check if an item/entity is a food item
  function isFoodItemEntity(entity) {
    try {
      // entity.metadata or entity.itemStack may hold item info depending on version
      const item = entity?.item || entity?.itemStack || entity?.nbt || null;
      // fallback: check display name or type string
      const name = (entity?.name || (item && item.name) || '').toLowerCase();
      // common food keywords
      const foods = ['apple','bread','pork','beef','chicken','mutton','cooked','potato','carrot','melon','cooked','cake','cookie','golden','fish','cod','salmon','honey','suspiciousstew','beetroot'];
      return foods.some(f => name.includes(f));
    } catch (e) { return false; }
  }

  async function tryPickupItem(entity) {
    if (!bot || !entity || tryingToPickup) return;
    // Check distance
    const pos = entity.position || (entity.entity && entity.entity.position);
    if (!pos) return;
    const dist = bot.entity.position.distanceTo(pos);
    if (dist > ITEM_PICKUP_RANGE) return;

    // Check if item seems like food
    if (!isFoodItemEntity(entity)) return;

    tryingToPickup = true;
    console.log('Found nearby food item, attempting to pick up and eat.');

    try {
      // Approach the item
      const goal = new GoalNear(pos.x, pos.y, pos.z, 1);
      bot.pathfinder.setGoal(goal);

      // wait until we are close enough or timeout
      const start = Date.now();
      while (Date.now() - start < 8000) { // wait up to 8s
        const curDist = bot.entity.position.distanceTo(new Vec3(pos.x, pos.y, pos.z));
        if (curDist <= 1.5) break;
        await sleep(300);
      }

      // stop moving forward control (we used pathfinder)
      bot.setControlState('forward', false);

      // wait briefly for pickup to happen automatically (Minecraft auto-pickup)
      await sleep(1200);

      // If hunger is low, autoEat plugin will eat automatically. We can also force eat if available.
      if (bot.food && bot.food < 18) {
        try {
          await bot.activateBlock; // noop placeholder (auto-eat should handle)
        } catch (e) {}
      }

      // clear pathfinder goal
      bot.pathfinder.setGoal(null);
    } catch (err) {
      // ignore path errors
      // console.warn('Pickup error:', err);
    } finally {
      tryingToPickup = false;
    }
  }

  // Auto-reconnect handling: when connection ends, recreate bot
  bot.on('end', () => {
    console.log('Connection ended. Will attempt reconnect in', RECONNECT_DELAY, 'ms');
    cleanupIntervals();
    setTimeout(() => {
      try {
        createBot();
      } catch (e) {
        console.error('Reconnect error:', e);
      }
    }, RECONNECT_DELAY);
  });

  bot.on('error', (err) => {
    console.log('Bot error:', err && err.message ? err.message : err);
  });

  // Helper: sleep
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // cleanup when process exits
  process.on('SIGINT', () => {
    console.log('Shutting down...');
    cleanupIntervals();
    try { bot?.quit(); } catch (e) {}
    process.exit();
  });

  function cleanupIntervals() {
    if (forwardIntervalId) { clearInterval(forwardIntervalId); forwardIntervalId = null; }
    if (jumpIntervalId) { clearInterval(jumpIntervalId); jumpIntervalId = null; }
    if (chatIntervalId) { clearInterval(chatIntervalId); chatIntervalId = null; }
    try { clearInterval(scanInterval); } catch (e) {}
  }
}

// Start first bot
createBot();
