# Reconstruction Plan

## Musk's Razor: Every system that adds code without adding decisions gets cut.

## CUT (9 systems, ~475 lines removed)

| # | System | Lines | Why Cut |
|---|--------|-------|---------|
| 1 | Audio (BGM + SFX) | ~85 | Sound doesn't drive decisions |
| 2 | Achievements (12) | ~50 | Post-hoc tracking, not in-game choices |
| 3 | Cycle/周目 (NG+) | ~60 | Complexity without decisions |
| 4 | Pet System | ~40 | Passive stat boost, no choice |
| 5 | Save/Load | ~40 | Anti-roguelike (permadeath is core) |
| 6 | Story Modal | ~40 | No decisions, just a wall of text |
| 7 | Portal System | ~20 | Random teleport, not decision-driving |
| 8 | Event Shop | ~30 | Duplicate of main shop (confirm() dialogs) |
| 9 | Weapon Effects (9 procs) | ~80 | Random procs on 10 weapons = equip highest ATK, no choice |

## SIMPLIFY

| What | From | To | Reason |
|------|------|----|--------|
| Weapons | 10 (9 random effects) | 3 (pure ATK) | Clear upgrade path, no proc noise |
| Elite enemies | 5 types | 3 (curse, split, reflect) | Keep only decision-driving abilities |
| Skills | 3/class (9 total) | 2/class (6 total) | Cut passive/auto-trigger skills |
| Map events | 7 types | 2 (elder, trap) | Keep dilemma + risk/reward only |

## KEEP (decision-driving mechanics)

1. **Map generation** — exploration decisions (which rooms to visit)
2. **Class selection** — 3 classes, different playstyles
3. **Combat** — engagement decisions (which enemy, when to fight)
4. **Items** — pickup decisions (heal now vs. save gold for shop)
5. **Shop** — purchase decisions (ATK vs DEF vs HP, limited gold)
6. **Curses + altar** — risk/reward (push forward with curse or detour to cleanse)
7. **Key + chest** — exploration decisions (go out of way for key)
8. **Skills** — energy resource allocation (when to heal vs. when to burst)
9. **Floor progression** — explore more or advance (risk death for more loot)
10. **Boss fight** — ultimate test of all decisions made
11. **Elder event** — 3-choice dilemma (heal / ATK / gamble)
12. **Trap tiles** — visible risk (take damage or avoid)

## TARGET

~800 lines (62% reduction from 2137). Zero loss in core gameplay value.
