# Spec — the drawing path must produce gesture provenance

**Status:** open. This is the keystone gap: it blocks groups-in-files, it makes
`ArtLayer.nest` a reader with no writer, and it is why every SVG this program
exports still carries zero `data-mode` / `data-orbit` / `data-reveal`.

## The gap, stated precisely

Three things are built, tested, and joined to nothing:

| built | tested | called by |
|---|---|---|
| `provenance.gestureLayers(history, book, opts)` | 28 tests | nothing |
| `EmitLayer.reveal` / `.mode` / `.orbit` | round trip asserted | import only |
| `EmitLayer.nest` + `timeline.compTrails` | reader complete, 6 tests | nothing |

`emitDoc()` builds its layer tree with `composer.emitLayersOf(comp, book)` —
the **editor's** layers, which are user-made containers and carry no gesture.
`provenance.gestureLayers` builds the **history's** layers, one per gesture,
each carrying `reveal`, `mode`, `orbit`. Nothing calls it.

## The mistake to avoid

"Populate `Layer.reveal` from the drawing path" is the obvious reading and it is
**wrong**. An editor layer is not a gesture: many gestures paint into one layer,
and a layer outlives every gesture that touched it. Giving `Layer` a `reveal`
would force one of them to win, which is the same "one number is a lie about the
others" error `provenance.ts` already argues at length about `orbit`.

The two layer trees answer different questions and both are legitimate:

- **editor layers** — *what is this drawing made of?* Structure the person built.
- **gesture layers** — *how did this drawing happen?* One node per beat.

## The design

`emitDoc()` chooses its layer tree by what the document is FOR.

```
still export      -> emitLayersOf(comp, book)          unchanged, byte-identical
animated export   -> gestureLayers(journal, book, …)   reveal/mode/orbit/nest
```

An animated export already discards the editor tree in practice — it emits one
group per reveal step — so this is not a loss of structure, it is the animated
path finally stating the structure it was always describing.

### Requirements

1. **Byte identity for the still path.** Not one byte of a still export changes.
   Assert on the exact bytes, not on a re-encode.

2. **`nest` gets its writer.** Gesture layers ARE beats, in play order, so
   `timeline.compTrails(tree)[k]` is the trail for the layer with `reveal: k`.
   That is the whole writer. A document with no groups writes no field.

3. **`revealBreak` must hold.** `serialise` refuses a child revealing before its
   ancestor. Gesture layers nest (`auto` mode: parent-plus-children when a
   drag's groups disagree in size), so the parent's reveal must be `<=` every
   child's. Assert it over a generated history, not a fixture.

4. **Erases.** `gestureLayers` drops erase edits unless given `unpainted`. The
   animated path already has an unpainted fill (`AnimationSpec.unpainted`).
   Pass it, and assert the reconstruction equality holds WITH erases in the
   history — the property that was false before `unpainted` existed.

5. **The in/out marks are `StepId` names in the model and integers in the file.**
   The file is the flattened render. `boundAnimation` already cuts before
   emission, so gesture layers must be built from the BOUND step list or the
   reveals will index a longer list than the file contains.

6. **Depth.** `gestureLayers` mints ids under a prefix it owns. `MAX_LAYERS` is
   8192 and `HISTORY_LIMIT` is 256, but `auto` nesting can add a child per brush
   application in a drag. Count before emitting and decline loudly rather than
   writing a file `parse` will refuse.

### Out of scope

- Holds. `insertHold` needs a between-the-beats target; no control addresses one.
- Tweens.
- Editor layers gaining any gesture field.

## Why this is the keystone

It closes, in one change:

- gesture provenance reaches a file for the first time since it was built
- `ArtLayer.nest` gets its writer, so **groups survive a save**
- the animated export states what made each stroke, readable by any SVG tool
- `focus.gestureResolver` gains real data to address

## Test plan

- still export byte-identical (exact payload, pinned)
- animated export carries `data-reveal` / `data-mode` / `data-orbit` per gesture
- `revealBreak(gestureLayers(...)) === null` over a generated history
- reconstruction equality holds with erases in the history
- a grouped timeline writes `nest`; an ungrouped one writes no such key
- round trip: export animated, import, re-export, bytes identical
- over `MAX_LAYERS`: declines loudly, writes nothing
