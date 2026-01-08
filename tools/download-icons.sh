#!/bin/bash
# Download icons from game-icons.net
# Icons are white on transparent background for easy tinting
# License: CC BY 3.0 - Attribution required

OUTPUT_DIR="$(dirname "$0")/icon-sources"
BASE_URL="https://game-icons.net/icons/ffffff/transparent/1x1"

mkdir -p "$OUTPUT_DIR"

echo "Downloading game-icons.net icons..."
echo "License: CC BY 3.0 - https://creativecommons.org/licenses/by/3.0/"
echo ""

# Array of icons to download: "filename:author/icon-name"
ICONS=(
  # Combat / Offense
  "crossed-swords:lorc/crossed-swords"
  "arrow-cluster:lorc/arrow-cluster"
  "lightning-frequency:lorc/lightning-frequency"
  "on-target:lorc/on-target"
  "pointy-sword:lorc/pointy-sword"
  "perspective-dice-six:delapouite/perspective-dice-six"
  "blast:lorc/blast"
  "wind-slap:lorc/wind-slap"
  "aura:lorc/aura"
  "stopwatch:lorc/stopwatch"
  "cycle:lorc/cycle"
  "fist:lorc/fist"
  "skull-crossed-bones:lorc/skull-crossed-bones"
  "death-zone:lorc/death-zone"
  "cracked-shield:lorc/cracked-shield"

  # Defense
  "heart-inside:lorc/heart-inside"
  "shield:sbed/shield"
  "health-decrease:lorc/health-decrease"
  "spiral-shell:lorc/spiral-shell"
  "vampire-dracula:delapouite/vampire-dracula"
  "star-swirl:lorc/star-swirl"
  "thorn-helix:lorc/thorn-helix"
  "crystal-ball:lorc/crystal-ball"
  "spark-spirit:lorc/spark-spirit"
  "hazard-sign:lorc/hazard-sign"
  "cross-mark:lorc/cross-mark"

  # Movement
  "wingfoot:lorc/wingfoot"
  "run:lorc/run"
  "ice-cube:lorc/ice-cube"
  "ghost:lorc/ghost"

  # Resources
  "book-cover:lorc/book-cover"
  "magnet:lorc/magnet"
  "coins:delapouite/coins"
  "cut-diamond:lorc/cut-diamond"
  "clover:lorc/clover"
  "bandage-roll:lorc/bandage-roll"
  "sunbeams:lorc/sunbeams"
  "swap-bag:lorc/swap-bag"
  "crown:lorc/crown"
  "rocket:lorc/rocket"

  # Utility
  "notebook:delapouite/notebook"
  "fast-forward-button:delapouite/fast-forward-button"
  "brain:lorc/brain"
  "clockwork:lorc/clockwork"
  "daemon-skull:lorc/daemon-skull"
  "angel-wings:lorc/angel-wings"

  # Elemental
  "fire:sbed/fire"
  "snowflake-2:lorc/snowflake-2"
  "poison-bottle:lorc/poison-bottle"
  "volcano:lorc/volcano"
  "linked-rings:lorc/linked-rings"
  "erlenmeyer:lorc/erlenmeyer"
  "broken-heart:lorc/broken-heart"
  "virus:lorc/virus"

  # Mastery
  "pistol-gun:john-colburn/pistol-gun"
  "robot-golem:lorc/robot-golem"
  "backpack:delapouite/backpack"
  "ringed-planet:lorc/ringed-planet"
  "grenade:lorc/grenade"
  "radar-sweep:lorc/radar-sweep"
  "dna1:lorc/dna1"
  "double-team:lorc/double-team"
  "trophy:lorc/trophy"

  # Weapons
  "sword-slice:lorc/sword-slice"
  "spinning-blades:lorc/spinning-blades"
  "laser-blast:lorc/laser-blast"
  "meteor-impact:lorc/meteor-impact"
  "flamethrower:delapouite/flamethrower"
  "thrown-daggers:lorc/thrown-daggers"
  "spiked-fence:lorc/spiked-fence"
  "delivery-drone:delapouite/delivery-drone"
  "shuriken:darkzaitzev/shuriken"
  "telescope:delapouite/telescope"
  "ricochet-ball:caro-asercion/ricochet"
  "burning-meteor:lorc/burning-meteor"

  # UI Controls
  "pause-button:delapouite/pause-button"
  "speaker:delapouite/speaker"
  "silence:lorc/silence"
  "musical-notes:delapouite/musical-notes"
  "forward:delapouite/forward"

  # Misc
  "wrench:sbed/wrench"
  "lightning-helix:lorc/lightning-helix"
  "big-star:lorc/big-star"
)

TOTAL=${#ICONS[@]}
COUNT=0
FAILED=0
FAILED_LIST=""

for entry in "${ICONS[@]}"; do
  filename="${entry%%:*}"
  path="${entry#*:}"
  url="${BASE_URL}/${path}.svg"
  output="${OUTPUT_DIR}/${filename}.svg"

  COUNT=$((COUNT + 1))
  echo -n "[$COUNT/$TOTAL] Downloading ${filename}... "

  if curl -sf "$url" -o "$output" 2>/dev/null; then
    echo "OK"
  else
    echo "FAILED"
    FAILED=$((FAILED + 1))
    FAILED_LIST="${FAILED_LIST}  - ${filename} (${path})\n"
  fi

  # Small delay to be nice to the server
  sleep 0.1
done

echo ""
echo "Download complete!"
echo "Success: $((TOTAL - FAILED))/$TOTAL"
if [ $FAILED -gt 0 ]; then
  echo "Failed downloads:"
  echo -e "$FAILED_LIST"
fi
echo ""
echo "Icons saved to: $OUTPUT_DIR"
