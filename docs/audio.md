# Sound: narration, the mix, subtitles

Everything sits in the project's audio folder (`"audio"` in motigen.json, default `audio/`):

```
audio/
  lines.txt        the script, one line per cue (L01, L02, …); blank lines and # comments are skipped
  vo/              L01.wav … + vo.json [{id, dur, text, speechStart, speechEnd}]; resp.json (the TTS response)
  bed.wav|mp3|…    the music, optional
  sfx/             click.wav, key.wav, enter.wav and any id used in events.sfx; sfx.json with each file's `hit`
  events.json      from `motigen events`
  mix.wav          from `motigen mix` (mix-raw.wav is the unmastered sum)
```

## Narration

Two things to set up once:

1. **The key.** Create an API key at elevenlabs.io (profile → API keys) and put it into a file named `.env` in
   the project folder, next to `motigen.json`: `ELEVENLABS_API_KEY=sk_…`. Every template ships `.env.example`
   to copy; `.env` is git-ignored. A variable exported in the shell works too and wins over the file.
2. **The voice.** `motigen vo voices` lists the voices of your account with their ids; put the one you want into
   `motigen.json`: `"vo": { "voice": "<id>", "model": "eleven_v4", "seed": 7042 }` (or pass `--voice`).

`motigen vo` then reads `lines.txt`, sends the whole script to ElevenLabs in one `with-timestamps` call
(`"vo": { "voice", "model", "seed", "settings" }` in motigen.json or `--voice`, `--model`,
`--seed`), saves the response as `audio/vo/resp.json` and splits it: each line is cut at the quietest point between
it and the next (the alignment runs a little late), silence is trimmed, and `vo.json` records the duration, the
text and the measured speech span of every line.

- `motigen vo split resp.json lines.txt` splits a saved response (no API call).
- `motigen vo import [dir] [lines.txt]` takes files you recorded or generated elsewhere (any format, sorted by
  name), renames them to L01…, and writes `vo.json`.
- `motigen vo check` prints the spectral flatness of every line and flags the breathy or garbled ones (`--limit`,
  default 0.12); exit code 2 when any is flagged.

Spelling for the voice is not spelling for the screen: write "Acme Cloud dot com" in `lines.txt` and put
`["Acme Cloud dot com", "acmecloud.com"]` under `"spellings"` so the subtitles read right.

## The mix

`motigen mix` builds `audio/mix.wav` from `events.json`:

1. Voice: every line peak-normalised to `voiceDb` (−3 dBFS) and placed at its cue.
2. Effects: `click` at every logged click (`clickDb` −14), `key` at every key press (`keyDb` −27 with a seeded
   ±2.5 dB jitter), `enter` at every Enter badge (`enterDb` −18), plus `events.sfx` entries by id. Files come from
   `audio/sfx/<id>.wav` (or `sfx.json`'s `file`, placed so the transient at `hit` lands on the event); missing
   click / key / enter / whoosh / pop / tick are synthesised (the scenes template cues a `whoosh` on every
   transition).
3. Music: the bed, looped from `bedLoopFrom` (8 s) with a `bedCrossfade` (2 s) when the film is longer, faded out
   over `bedFadeOut` (3 s), levelled to `bedRmsDb` (−36 dB RMS), then ducked under the voice by `duckDb` (−9) with
   `duckAttack` 120 ms and `duckRelease` 450 ms.
4. Master: `"master": "loudnorm"` (default) runs ffmpeg's EBU R128 normaliser in two passes to `target.lufs` −14 /
   `target.dbtp` −1 / `target.lra` 11; `"master": "limiter"` applies a linear gain and a look-ahead limiter instead
   (no ffmpeg, flatter dynamics).

All of these are keys under `"mix"` in motigen.json. The canvas kit mixes inside the page with its own levels and
the effects library; `"mix": { "engine": "page" }` makes `motigen mix` save that instead.

## Subtitles

`motigen srt` writes one cue per voice line, from its event time to that plus its duration, with the written forms
from `"spellings"` put back. `motigen build` runs it after the render, next to the video.
