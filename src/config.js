window.G = window.G || {};

// Tuning values for the whole game. Units: meters, seconds, radians.
G.CFG = {
  difficulty: {
    easy:   { label: 'Dễ',     enemyCount: 8,  stalkers: 3, enemyAccuracy: 0.20, reactionTime: 0.90, enemyDamage: 7,  playerHealth: 100 },
    normal: { label: 'Thường', enemyCount: 13, stalkers: 2, enemyAccuracy: 0.40, reactionTime: 0.60, enemyDamage: 10, playerHealth: 100 },
    hard:   { label: 'Khó',    enemyCount: 18, stalkers: 2, enemyAccuracy: 0.55, reactionTime: 0.40, enemyDamage: 14, playerHealth: 100 }
  },
  difficultyOrder: ['easy', 'normal', 'hard'],
  defaultDifficulty: 'normal',

  player: {
    walkSpeed: 4.5,
    sprintSpeed: 7,
    crouchSpeed: 2.4,
    backMul: 0.8,            // speed multiplier when moving backwards
    adsSpeedMul: 0.6,        // speed multiplier at full ADS
    jumpSpeed: 5.2,
    gravity: 18,
    height: 1.8,
    crouchHeight: 1.2,
    eyeHeight: 1.65,
    crouchEyeHeight: 1.1,
    crouchRate: 7,           // crouch transition speed (1/s)
    radius: 0.35,
    stepHeight: 0.45,        // max ledge the player walks onto
    stepDown: 0.5,           // max drop that still snaps to the ground
    groundAccel: 50,
    airAccel: 6,
    mouseSensitivity: 0.0022, // rad per pixel
    fov: 75,
    adsFov: 55,
    pitchLimit: 1.5,
    bounds: { minX: -62, maxX: 62, minZ: -102, maxZ: 102 },
    fallLimit: -30,          // below this y the player is put back at the start
    bob: {
      walkAmp: 0.03, sprintAmp: 0.055, crouchAmp: 0.015, adsMul: 0.25,
      stepLenWalk: 2.0, stepLenSprint: 2.5, stepLenCrouch: 1.4
    }
  },

  combat: {
    shotDamage: 50,          // base damage per bullet before the part multiplier
    headMul: 3,
    limbMul: 0.6,
    alertRadius: 45,
    maxRange: 400,
    kickScale: 1             // multiplier on weapon kick (kick is read as radians)
  },

  regen: { delay: 5, rate: 4 },          // seconds without damage, hp per second
  crate: { ammo: 60, range: 2.2, cooldown: 25 },
  objective: { holdTime: 3 },

  flow: { deathScreenDelay: 1.9, winScreenDelay: 2.4 }
};
