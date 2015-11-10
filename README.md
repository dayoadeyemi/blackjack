requires node > v4.0.0

commands available are

print state 	-- show info about current hands/player

save <key>  	-- persist current game state to redis

load <key>      -- load the game state save as <key>

hit				-- performs hit action when asked to hit or stick

stick			-- performs stick action when asked to hit or stick
