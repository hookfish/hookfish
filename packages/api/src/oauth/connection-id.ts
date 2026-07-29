/**
 * Memorable connection ids: `randomword-randomword-randomnumber`
 * (e.g. `swift-orchid-4821`).
 */

const WORDS = [
  'able',
  'acer',
  'acid',
  'aged',
  'amber',
  'apex',
  'aqua',
  'arch',
  'arid',
  'ash',
  'atom',
  'azure',
  'bark',
  'basil',
  'beam',
  'berry',
  'blaze',
  'bloom',
  'bold',
  'breeze',
  'brick',
  'brisk',
  'brook',
  'cactus',
  'calm',
  'canyon',
  'cedar',
  'charm',
  'clear',
  'cliff',
  'cloud',
  'coast',
  'comet',
  'coral',
  'crisp',
  'crown',
  'delta',
  'dew',
  'dune',
  'eagle',
  'ember',
  'fable',
  'fern',
  'field',
  'flame',
  'flint',
  'flora',
  'fog',
  'forest',
  'frost',
  'glade',
  'glow',
  'gold',
  'grain',
  'grove',
  'harbor',
  'haze',
  'helix',
  'hollow',
  'honey',
  'iris',
  'ivory',
  'jade',
  'jazz',
  'keen',
  'lake',
  'leaf',
  'light',
  'lilac',
  'linen',
  'lotus',
  'lucky',
  'lunar',
  'maple',
  'marsh',
  'meadow',
  'mint',
  'mist',
  'moss',
  'noble',
  'north',
  'nova',
  'oak',
  'ocean',
  'olive',
  'onyx',
  'opal',
  'orbit',
  'orchid',
  'otter',
  'peak',
  'pearl',
  'pine',
  'plain',
  'plume',
  'pond',
  'prism',
  'quill',
  'quiet',
  'rain',
  'raven',
  'reef',
  'ridge',
  'river',
  'robin',
  'rocky',
  'rose',
  'ruby',
  'sage',
  'sand',
  'shadow',
  'sharp',
  'shore',
  'silk',
  'silver',
  'slate',
  'smoke',
  'snow',
  'solar',
  'spark',
  'spice',
  'spruce',
  'stone',
  'storm',
  'sunny',
  'swift',
  'tide',
  'timber',
  'topaz',
  'trail',
  'tree',
  'valley',
  'vapor',
  'velvet',
  'vivid',
  'wave',
  'wheat',
  'wild',
  'willow',
  'wind',
  'winter',
  'wolf',
  'wood',
  'zenith',
] as const

/** Uniform index in `[0, max)` via rejection sampling (avoids modulo bias). */
function randomIndex(max: number): number {
  if (max <= 0 || max > 0x1_0000_0000) {
    throw new RangeError(`randomIndex max out of range: ${max}`)
  }

  const limit = 0x1_0000_0000 - (0x1_0000_0000 % max)
  const buf = new Uint32Array(1)

  for (;;) {
    crypto.getRandomValues(buf)
    if (buf[0] < limit) return buf[0] % max
  }
}

function pickWord(): string {
  return WORDS[randomIndex(WORDS.length)]!
}

/** Four-digit suffix keeps ids short and readable (`0000`–`9999`). */
function pickNumber(): string {
  return String(randomIndex(10_000)).padStart(4, '0')
}

export function generateConnectionId(): string {
  return `${pickWord()}-${pickWord()}-${pickNumber()}`
}
