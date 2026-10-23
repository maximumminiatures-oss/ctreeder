# Orphan Guardians

Catalog audit: October 21, 2026. Source: `S3_content/data/shadowdark-content.json`,
using its complete `monsters` array rather than a dungeon-level encounter subset.
No monster files, canonical IDs, statistics, or gameplay names were changed.

## Eligibility

The only eligibility rule is a recorded Intelligence **modifier of 0 or higher**
(`I > -1`). Alignment, creature category, dungeon level, and apparent suitability
as a guardian do not add restrictions.

- Total catalog records: **557**.
- Eligible source records: **111**.
- Records with negative Intelligence modifiers: **153**.
- Records with missing or invalid Intelligence modifiers: **293**.
- Unique eligible guardian types after display-name normalization: **95**.
- Eligible repeated records removed from the pool: **16**.

Missing, empty, or invalid Intelligence is not treated as zero. The helper reads
`I`, the current encounter-table key `**I**`, or an explicit `intelligence`
modifier. It does not infer a modifier from an ability score or creature type.

## Integration

`S3_content/src/creature-names.js` exports:

- `buildGuardianPool(monsters)`: sorted `{name, sourceName, intelligence}` records.
- `creatureTypeName(name)`: lowercase common-noun display form only.
- `indefiniteArticle(name)`: `a` or `an`, including pronunciation exceptions.

For each unique formatted type, the first eligible input record supplies the raw
`sourceName` and numeric `intelligence`. This preserves the catalog's existing
core-before-SRD ordering. All repeated eligible types in this audit agree on
Intelligence; there are no conflicting modifiers to resolve.

Example sentences:

- You were raised by an oni.
- You were raised by a sea hag.
- You were raised by an elf.
- You were raised by a unicorn.

Assignment, random selection, and persistence belong to the background system;
this module does not implement or alter them.

## Name Handling

Comma-form descriptions are put in ordinary prose order, such as `Hag, Sea` to
`sea hag`, `Giant, Cloud` to `cloud giant`, and `Drow, Priestess` to `drow priestess`.
`Demon, Marilith` and `Marilith` become the same guardian type, `marilith`, rather
than giving that type extra selection weight. The equivalent demon subtype
format is also supported for balor, glabrezu, and vrock.

Leading articles are removed from type descriptions: the raw `The Tarrasque`
becomes `tarrasque`, allowing `a tarrasque`. Its current catalog Intelligence is
**+3**. This changes display grammar only, not the source name or ID.

`cubi`, `domini`, `principi`, `merfolk`, and `mushroomfolk` retain their catalog
forms. No unapproved singular form or new guardian-selection mechanic is
invented; they use the ordinary `a` article under the requested contract.

Repeated eligible types are aboleth, azer, balor, berserker, couatl, duergar,
glabrezu, gladiator, hobgoblin, kraken, lich, marilith, medusa, oni, rakshasa,
and weald hag. Most repetitions are core/SRD overlaps; weald hag has two catalog
slugs, and marilith additionally needs the category-name normalization above.

## Complete Eligible Pool

Names below are the exact sorted helper output. `Source Name` retains the first
eligible catalog spelling. Intelligence values are modifiers, not ability scores.

| Guardian Type | Intelligence | Source Name |
| --- | ---: | --- |
| aboleth | +4 | Aboleth |
| apprentice | +2 | Apprentice |
| archangel | +4 | Archangel |
| archdevil | +5 | Archdevil |
| archmage | +4 | Archmage |
| assassin | +2 | Assassin |
| azer | +0 | Azer |
| balor | +4 | Balor |
| barbed devil | +1 | Barbed Devil |
| berserker | +0 | Berserker |
| brain eater | +4 | Brain Eater |
| centaur | +0 | Centaur |
| cloaker | +1 | Cloaker |
| cloud giant | +3 | Giant, Cloud |
| couatl | +4 | Couatl |
| cubi | +3 | Cubi |
| deep gnome | +1 | Deep Gnome |
| desert dragon | +4 | Dragon, Desert |
| djinni | +4 | Djinni |
| domini | +3 | Domini |
| doppelganger | +1 | Doppelganger |
| drider | +2 | Drider |
| drow | +1 | Drow |
| drow priestess | +3 | Drow, Priestess |
| druid | +4 | Druid |
| dryad | +1 | Dryad |
| duergar | +0 | Duergar |
| efreeti | +3 | Efreeti |
| elf | +1 | Elf |
| erinyes | +4 | Erinyes |
| ettercap | +0 | Ettercap |
| fairy | +1 | Fairy |
| fire dragon | +4 | Dragon, Fire |
| fire giant | +1 | Giant, Fire |
| forest dragon | +3 | Dragon, Forest |
| frost dragon | +3 | Dragon, Frost |
| frost giant | +2 | Giant, Frost |
| gargoyle | +0 | Gargoyle |
| ghast | +0 | Ghast |
| ghost | +0 | Ghost |
| glabrezu | +3 | Glabrezu |
| gladiator | +0 | Gladiator |
| goblin shaman | +0 | Goblin Shaman |
| guard | +0 | Guard |
| harpy | +0 | Harpy |
| hobgoblin | +2 | Hobgoblin |
| horned devil | +2 | Horned Devil |
| imp | +1 | Imp |
| invisible stalker | +2 | Invisible Stalker |
| knight | +0 | Knight |
| kraken | +4 | Kraken |
| leprechaun | +2 | Leprechaun |
| lich | +4 | Lich |
| mage | +3 | Mage |
| marilith | +3 | Demon, Marilith |
| medusa | +2 | Medusa |
| merfolk | +0 | Merfolk |
| minotaur | +1 | Minotaur |
| mummy | +3 | Mummy |
| mushroomfolk | +0 | Mushroomfolk |
| naga | +2 | Naga |
| night hag | +2 | Night Hag |
| oni | +2 | Oni |
| peasant | +0 | Peasant |
| phoenix | +3 | Phoenix |
| pirate | +0 | Pirate |
| priest | +0 | Priest |
| principi | +4 | Principi |
| rakshasa | +3 | Rakshasa |
| reaver | +0 | Reaver |
| rime walker | +2 | Rime Walker |
| scarecrow | +0 | Scarecrow |
| sea dragon | +4 | Dragon, Sea |
| sea hag | +1 | Sea Hag |
| seraph | +2 | Seraph |
| siren | +2 | Siren |
| soldier | +0 | Soldier |
| sphinx | +4 | Sphinx |
| stone giant | +1 | Giant, Stone |
| storm giant | +3 | Storm Giant |
| swamp dragon | +4 | Swamp Dragon |
| tarrasque | +3 | The Tarrasque |
| thief | +0 | Thief |
| treant | +2 | Treant |
| unicorn | +1 | Unicorn |
| vampire | +1 | Vampire |
| viperian | +0 | Viperian |
| viperian ophid | +1 | Viperian Ophid |
| viperian wizard | +3 | Viperian Wizard |
| void spawn | +0 | Void Spawn |
| weald hag | +1 | Weald Hag |
| werewolf | +0 | Werewolf |
| wight | +1 | Wight |
| winter wolf | +0 | Winter Wolf |
| wraith | +0 | Wraith |
