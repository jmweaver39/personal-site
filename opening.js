/* The home page's opening, when index.html's head script asks for it. The name
   types, then scrambles while its letters are dealt out onto two mono lines that
   lock into "projects" and "research". Four more letters split off the name and
   slide to where the logos go, locking as each logo's initial. Then everything
   breaks into red, green and blue and jumps into the words and logos. */

const TEXT = "jaymweaver.com";
const KEY_GAPS = [0, 70, 65, 80, 65, 60, 75, 70, 55, 70, 120, 75, 65, 70];
const TYPE_START = 350;
const HOLD_TEXT = 600;   // the name sits still before the opening takes over
const LOAD_WAIT = 1500;  // slow fonts or logos hold the typing back this long at most

const ALPHABET = "abcdefghijklmnopqrstuvwxyz";
const FONT = '400 25px/1.3 "IBM Plex Mono", ui-monospace, monospace';
const CHANNELS = ["#ff0000", "#00ff00", "#0000ff"];
const ICON_LETTERS = ["l", "x", "g", "m"];
const ICON_SLOTS = [1, 5, 9, 13];   // the letter of the name each one splits off

/* All in ms after play starts */
const CYCLE = 30;        // how long a random letter holds
const RIPPLE = 7;        // the scramble runs along the name at this step
const SPLIT_AT = 70;     // the letters leave the name's line
const SPLIT = 290;
const LOCK_AT = 265;     // the first letter locks
const LOCK_STEP = 27;    // and each one after it
const LOCK_LINE = 24;    // the second line locks this much later
const ICON_LOCK = 400;   // the first icon letter locks
const GLITCH_AT = 530;   // the lines split into colour
const PULLS = 3;         // cuts the mono copies make
const PULL = 34;         // how long each cut holds
const WORD_AT = 595;     // the copies of the word start to jump
const JUMPS = 6;         // cuts those copies make
const JUMP = 30;         // how long each cut holds
const WORD_LINE = 24;    // the second line does all of this this much later
const ICON_AT = 660;     // the first icon letter splits into colour
const ICON_STEP = 34;    // and each one after it
const ICON_GAP = 65;     // the logo's copies start jumping this much after its letter splits
const END = ICON_AT + (ICON_LETTERS.length - 1) * ICON_STEP + ICON_GAP + JUMPS * JUMP;

const root = document.documentElement;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomLetter = () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
const place = (x, y) => `translate(${x}px, ${y}px)`;
const spread = (size) => (Math.random() - 0.5) * size;
const hold = (frames) => frames.map((frame, i) => (i < frames.length - 1 ? { ...frame, easing: "step-end" } : frame));

/* The jumps into register, from far out to exactly in place */
function jumps(shove) {
  const frames = [];
  for (let k = 0; k <= JUMPS; k++) {
    const left = 1 - k / JUMPS;
    frames.push({
      offset: k / JUMPS,
      transform: k === JUMPS ? "none" : `translate(${spread(shove * left * 2)}px, ${spread(shove * left * 0.5)}px)`,
      opacity: k === JUMPS || Math.random() > 0.15 ? 1 : 0.3,
    });
  }
  return frames;
}

/* A copy of a word, on top of where it sits */
function copyOf(ctx, word, colour) {
  const anchor = ctx.layer.getBoundingClientRect();
  const box = word.svg.getBoundingClientRect();
  const wrap = document.createElement("div");
  wrap.className = "word";
  wrap.style.cssText = `position: absolute; left: ${box.left - anchor.left}px; top: ${box.top - anchor.top}px; `
    + `width: ${box.width}px; height: ${box.height}px; transition: none; mix-blend-mode: screen;`;
  const svg = word.svg.cloneNode(true);
  svg.querySelector("text.ink").style.stroke = colour;
  wrap.append(svg);
  ctx.layer.append(wrap);
  return wrap;
}

/* A copy of a logo in one colour. The logos are images, so the colour multiplies
   over them on black, and screen then drops the black again */
function iconCopy(ctx, link, colour) {
  const anchor = ctx.layer.getBoundingClientRect();
  const box = link.getBoundingClientRect();
  const wrap = document.createElement("div");
  wrap.style.cssText = `position: absolute; left: ${box.left - anchor.left}px; top: ${box.top - anchor.top}px; `
    + `width: ${box.width}px; height: ${box.height}px; background: #000000; mix-blend-mode: screen;`;
  const tint = document.createElement("div");
  tint.style.cssText = `position: absolute; inset: 0; background: ${colour}; mix-blend-mode: multiply;`;
  wrap.append(link.querySelector(".icon").cloneNode(true), tint);
  ctx.layer.append(wrap);
  return wrap;
}

/* White mono letters at these spots cut to three coloured sets that pull apart.
   `fill` puts one set's letters in the box it's given */
function pullApart(ctx, at, unit, fill) {
  CHANNELS.forEach((colour, i) => {
    const split = document.createElement("div");
    split.style.cssText = "position: absolute; left: 0; top: 0; mix-blend-mode: screen;";
    ctx.layer.append(split);
    fill(split, colour);
    const way = ((i - 1) * 16 + (i === 1 ? 7 : 0)) * unit;
    ctx.run(split, [{ opacity: 0 }, { opacity: 0 }], { duration: at, easing: "linear", fill: "backwards" });
    ctx.run(split, hold([
      { offset: 0, transform: `translate(${way * 0.5}px, ${spread(6 * unit)}px)`, opacity: 1 },
      { offset: 1 / 3, transform: `translate(${way}px, ${spread(10 * unit)}px)`, opacity: 0.7 },
      { offset: 2 / 3, transform: `translate(${way * 2}px, ${spread(14 * unit)}px)`, opacity: 0.3 },
      { offset: 1, transform: `translate(${way * 3}px, 0)`, opacity: 0 },
    ]), { delay: at, duration: PULLS * PULL, easing: "linear", fill: "forwards" });
  });
}

function play(ctx) {
    /* Measure everything first: the animations below move these boxes */
    const anchor = ctx.layer.getBoundingClientRect();
    const firstChar = ctx.chars[0].getBoundingClientRect();
    const secondChar = ctx.chars[1].getBoundingClientRect();
    const charW = secondChar.left - firstChar.left;
    const charH = firstChar.height;
    const nameX = firstChar.left + firstChar.width / 2 - anchor.left;
    const nameY = firstChar.top + charH / 2 - anchor.top;
    const unit = ctx.u() * 2;

    const lines = ctx.words.map((word) => {
      const box = word.svg.getBoundingClientRect();
      return {
        word,
        letters: [...word.string.toLowerCase()],
        lineX: box.left + box.width / 2 - anchor.left,
        lineY: box.top + box.height / 2 - anchor.top,
      };
    });
    const icons = ctx.links.map((link) => {
      const box = link.getBoundingClientRect();
      return { link, x: box.left + box.width / 2 - anchor.left, y: box.top + box.height / 2 - anchor.top };
    });

    const makeLetter = (text) => {
      const el = document.createElement("span");
      el.textContent = text;
      el.style.cssText = `position: absolute; left: ${-charW / 2}px; top: ${-charH / 2}px; `
        + `width: ${charW}px; height: ${charH}px; font: ${FONT}; color: #ffffff; `
        + "text-align: center; white-space: pre;";
      return el;
    };
    const colouredLetter = (text, x, y, colour) => {
      const copy = makeLetter(text);
      copy.style.color = colour;
      copy.style.transform = place(x, y);
      return copy;
    };

    /* The stand-ins take over from the typed name in this same tick */
    ctx.run(ctx.typed, [{ opacity: 0 }, { opacity: 0 }], { duration: 1 });

    const glyphs = [];
    lines.forEach((line, n) => {
      const cutAt = GLITCH_AT + n * WORD_LINE;
      const wordAt = WORD_AT + n * WORD_LINE;
      const spots = [];

      line.letters.forEach((letter, j) => {
        /* The name is dealt out in turn: odd places to one line, even to the
           other. Each line is one letter too long for that, so the spare one
           starts just past the end of the name and fades in */
        const slot = 2 * j - n;
        const typedChar = ctx.chars[slot];
        const startX = nameX + slot * charW;
        const lineLetterX = line.lineX + (j - (line.letters.length - 1) / 2) * charW;

        const el = makeLetter(typedChar ? typedChar.textContent : "");
        ctx.layer.append(el);
        spots.push([letter, lineLetterX]);

        glyphs.push({
          el,
          letter,
          startAt: (slot + 1) * RIPPLE,
          lockAt: LOCK_AT + j * LOCK_STEP + n * LOCK_LINE,
        });

        ctx.run(el, [{ transform: place(startX, nameY) }, { transform: place(lineLetterX, line.lineY) }], {
          delay: SPLIT_AT,
          duration: SPLIT,
        });
        if (!typedChar) {
          ctx.run(el, [{ opacity: 0 }, { opacity: 1 }], { delay: SPLIT_AT, duration: 100, easing: "linear" });
        }

        /* "forwards" so this leaves the split alone until its turn */
        ctx.run(el, [{ opacity: 0 }, { opacity: 0 }], { delay: cutAt, duration: 1, easing: "linear", fill: "forwards" });
      });

      pullApart(ctx, cutAt, unit, (split, colour) => {
        for (const [letter, x] of spots) split.append(colouredLetter(letter, x, line.lineY, colour));
      });

      CHANNELS.forEach((colour) => {
        const copy = copyOf(ctx, line.word, colour);
        ctx.run(copy, [{ opacity: 0 }, { opacity: 0 }], { duration: wordAt, easing: "linear", fill: "backwards" });
        ctx.run(copy, hold(jumps(34 * unit)), { delay: wordAt, duration: JUMPS * JUMP, easing: "linear", fill: "forwards" });
      });

      /* The copies are the word to the very end: with the real one under them
         as well, its outline would look heavier */
      ctx.run(line.word.svg, [{ opacity: 0 }, { opacity: 0 }], { duration: END, easing: "linear", fill: "backwards" });
    });

    icons.forEach(({ link, x, y }, i) => {
      const slot = ICON_SLOTS[i];
      const cutAt = ICON_AT + i * ICON_STEP;
      const iconAt = cutAt + ICON_GAP;
      const landAt = iconAt + JUMPS * JUMP;

      /* It starts exactly on a letter of the name, so it only shows once it moves */
      const el = makeLetter(ctx.chars[slot].textContent);
      ctx.layer.append(el);
      glyphs.push({ el, letter: ICON_LETTERS[i], startAt: (slot + 1) * RIPPLE, lockAt: ICON_LOCK + i * LOCK_STEP });
      ctx.run(el, [{ transform: place(nameX + slot * charW, nameY) }, { transform: place(x, y) }], {
        delay: SPLIT_AT,
        duration: SPLIT,
      });
      ctx.run(el, [{ opacity: 0 }, { opacity: 0 }], { delay: cutAt, duration: 1, easing: "linear", fill: "forwards" });

      pullApart(ctx, cutAt, unit, (split, colour) => {
        split.append(colouredLetter(ICON_LETTERS[i], x, y, colour));
      });

      CHANNELS.forEach((colour) => {
        const copy = iconCopy(ctx, link, colour);
        ctx.run(copy, [{ opacity: 0 }, { opacity: 0 }], { duration: iconAt, easing: "linear", fill: "backwards" });
        ctx.run(copy, hold(jumps(16 * unit)), { delay: iconAt, duration: JUMPS * JUMP, easing: "linear", fill: "forwards" });
        /* The real logo takes over on the cut they land */
        ctx.run(copy, [{ opacity: 0 }, { opacity: 0 }], { delay: landAt, duration: 1, easing: "linear", fill: "forwards" });
      });
      ctx.run(link, [{ opacity: 0 }, { opacity: 0 }], { duration: landAt, easing: "linear", fill: "backwards" });
    });

    /* Runs on a timer, not frames, so a hidden tab can't leave it waiting */
    const began = performance.now();
    const lastLock = Math.max(...glyphs.map((glyph) => glyph.lockAt));
    const cycle = () => {
      const t = performance.now() - began;
      for (const glyph of glyphs) {
        if (t >= glyph.lockAt) glyph.el.textContent = glyph.letter;
        else if (t >= glyph.startAt) glyph.el.textContent = randomLetter();
      }
      if (t < lastLock) setTimeout(cycle, CYCLE);
    };
    cycle();
}

async function start() {
  const stage = document.querySelector(".stage");
  const entries = [...document.querySelectorAll(".entry")];
  const contact = document.querySelector(".links");
  const links = [...contact.children];
  const typed = document.createElement("p");
  typed.id = "typed";
  typed.setAttribute("aria-hidden", "true");
  const layer = document.createElement("div");
  layer.id = "layer";
  layer.setAttribute("aria-hidden", "true");
  stage.prepend(typed);
  stage.append(layer);
  for (const piece of [...entries, contact]) piece.inert = true;

  const moves = [];
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('200px "League Gothic"', "ProjectsResearch"),
        document.fonts.load('25px "IBM Plex Mono"', TEXT),
        ...[...contact.querySelectorAll("img")].map((img) => img.decode()),
      ]).catch(() => {}),
      wait(LOAD_WAIT),
    ]);

    await wait(TYPE_START);
    for (let i = 0; i < TEXT.length; i++) {
      await wait(KEY_GAPS[i]);
      const char = document.createElement("span");
      char.className = "ch";
      char.textContent = TEXT[i];
      typed.append(char);
    }
    await wait(HOLD_TEXT);

    root.dataset.phase = "playing";
    play({
      typed,
      chars: [...typed.children],
      words: entries.map((entry) => {
        const word = entry.querySelector(".word");
        const svg = word.querySelector("svg");
        const text = svg.querySelector("text.ink");
        return { word, svg, text, string: text.textContent };
      }),
      links,
      layer,
      u: () => links[0].offsetWidth / 48,
      run(el, frames, options) {
        const move = el.animate(frames, { easing: "cubic-bezier(0.76, 0, 0.24, 1)", fill: "both", ...options });
        moves.push(move);
        return move;
      },
    });
    await Promise.allSettled(moves.map((move) => move.finished));
  } finally {
    for (const move of moves) move.cancel();
    typed.remove();
    layer.remove();
    for (const piece of [...entries, contact]) piece.inert = false;
    delete root.dataset.phase;
  }
}

if (root.dataset.phase) start();
