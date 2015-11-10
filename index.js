const R = require('ramda');
const hl = require('highland');
var redis = require("redis");
hl.streamifyAll(redis.RedisClient.prototype);
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});
const client = redis.createClient();

const inputs = hl((push) => {
	rl.on('line', (line) => {
		push(null, line);
		rl.prompt()
	})
});

function create_card(rank, suit){
	return {
		name: rank+suit,
	    values : rank === 'A' ? [11, 1] :
			R.contains(rank, ['J','Q','K']) ? [10] :
			[parseInt(rank, 10)]
	}
};

const SUITS = ['♠', '♥', '♦', '♣'],
	RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'],
	DECK = R.map(x => create_card(x[0], x[1]), R.xprod(RANKS, SUITS));

function create_initial_state(PLAYER_COUNT){
	return {
		action: 'bet',
		deck: shuffle(DECK),
		players: R.times(create_player, PLAYER_COUNT+1),
		current_player: 1,
	}
}

function get_player(state){
	return state.players[state.current_player]
}

function shuffle(array){
	const from = R.clone(array), to = []
	while (from.length) {
		to.push(from.splice(Math.floor(Math.random() * from.length), 1));
	}
	return R.unnest(to);
}

function create_player(i){
	return {
		name: i ? 'player ' + i : 'dealer',
		is_dealer: !i,
		hand: [],
		funds: i ? 500 : 0,
		bet: 0
	}
}

var update_player = function (player_fn, old_state){
	return R.evolve({ players: R.adjust(player_fn, old_state.current_player) }, old_state);
}

function deal(old_state){
	const card_drawn = R.head(old_state.deck),
		new_hand = R.append(card_drawn, get_player(old_state).hand)
	console.log('dealt ' + card_drawn.name + ' to ' + get_player(old_state).name)
	return R.pipe(
		R.assoc('deck', R.tail(old_state.deck)),
		R.partial(update_player, [R.assoc('hand', new_hand)])
	)(old_state);
}

var place_bet = R.curryN(2, function (bet, old_state){
	const new_state = update_player(R.evolve({
			funds: R.add(-bet),
			bet: R.always(bet)
		}), old_state),
		player = get_player(new_state);
	console.log(player.name + ' has bet £'+ bet + ', and has £'+player.funds + ' remaining');
	return new_state;
})

var pay_bet = function (old_state){
	const bet = get_player(old_state).bet,
		new_state = update_player(R.evolve({
			funds: R.add(2*bet),
			bet: R.always(0)
		}), old_state),
		player = get_player(new_state);
	console.log(player.name + ' won £'+ 2*bet + ', and now has £'+player.funds + ' remaining');
	return new_state;
}

var lose_bet = function (old_state){
	const bet = get_player(old_state).bet,
		new_state = update_player(R.assoc('bet', 0), old_state),
		player = get_player(new_state);
	console.log(player.name + ' lost thier £'+ bet + ' bet, and now has £'+player.funds + ' remaining');
	return new_state;
}

function move_on(old_state){
	const next_player = (old_state.current_player+1)%old_state.players.length,
		new_state = R.assoc('current_player', next_player, old_state);
	console.log('moving on to', get_player(new_state).name)
	print_player(get_player(new_state))
	return new_state;
}

function start_dealing_if_dealer(old_state){
	if (get_player(old_state).is_dealer) {
		console.log('the dealer doesn\'t need to bet')
		return R.pipe(
			move_on,
			R.apply(R.pipe,
				R.unnest(
					R.repeat(
						[deal, deal, move_on],
						old_state.players.length))),
			hit_or_stick
		)(old_state);
	}
	return new_state;
}


function hit_or_stick(old_state){
	const hand_values = get_hand_values(get_player(old_state));
	const hand_min = R.reduce(R.min, Infinity, hand_values);
	const hand_max = R.reduce(R.max, 0, hand_values);
	const hand_value = hand_max > 21 ? hand_min : hand_max;
	var new_players;
	if (get_player(old_state).is_dealer) {
		if (hand_max < 17) {
			console.log('dealer hits');
			return hit_or_stick(deal(old_state));
		} else {
			console.log('dealer sticks with ' + R.pluck('name', get_player(old_state).hand) + ' = ' + hand_value);
			new_players = R.map(player => {
				if (player.bet > 0) {
					const p_hand_values = get_hand_values(get_player(old_state));
					const p_hand_min = R.reduce(R.min, Infinity, p_hand_values);
					const p_hand_max = R.reduce(R.max, 0, p_hand_values);
					const p_hand_value = p_hand_max > 21 ? p_hand_min : p_hand_max;


					if (p_hand_value === 21 || hand_value > 21 || (p_hand_value <= 21 && p_hand_value > hand_value)){
						console.log(player.name + ' won the bet with ' 
							+ R.pluck('name', player.hand) + ' = ' 
							+ p_hand_value +' and gained £'+ 2*player.bet);
						return R.evolve({
							funds: R.add(2*player.bet),
							bet: R.always(0)
						}, player);
					}
					console.log(player.name + ' lost the bet of £' 
						+ player.bet + ' with ' + R.pluck('name', player.hand)
						+ ' = ' + p_hand_value);
					return R.evolve({
						bet: R.always(0)
					}, player);
				}
				return player;
			}, old_state.players)

			return new_round(R.assoc('players', new_players, old_state));
		}
	} else {
		if (hand_min === 21) {
			console.log(R.pluck('name', get_player(old_state).hand) + ' = 21 Blackjack!')
			return hit_or_stick(move_on(pay_bet(old_state)));
		} else if (hand_min > 21) {
			console.log(R.pluck('name', get_player(old_state).hand) + ' = ' + hand_min, 'Bust!')
			return hit_or_stick(move_on(lose_bet(old_state)));
		} else {
			console.log("hit or stick?")
			return R.assoc('action', 'hit_or_stick', old_state);
		}
	}
}


function get_hand_values(player){
	return R.reduce(R.lift(R.add), [0], R.pluck('values', player.hand));
}
// test - getHandValues
// hl([2,4,6])
// .map(rank => [rank,'X'])
// .scan([], (b, a) => [a].concat(b))
// .map(getHandValues)
// .each(console.log);

function new_round(old_state){
	console.log('new round please place your bet')
	return move_on(R.merge(old_state, {
		players: R.map(R.assoc('hand', []), old_state.players),
		deck: shuffle(DECK),
		current_player: 0,
		action: 'bet'
	}));
}

function print_player(player){
	console.log(player.name, '--> funds: £'+ player.funds, R.isEmpty(player.hand) ? '' : '| hand : '+ R.pluck('name', player.hand).join(', '), player.bet ? '| bet : £' + player.bet : '' );
	return player;
}

function print_state(state){
	return state;
}

inputs
.flatMap(input => {
	if ((vars = input.split(' '))[0] === 'load') {
		return client.getStream(vars[1])
		.map(JSON.parse)
		.map(json => {
			if (json === null) throw new Error('no state saved at: ' + vars[1])
			console.log('successfully loaded state at:', vars[1])
			return json;
		})
		.errors(e => console.log('load failed:', e))
	} else return hl([input]);
})
.scan(create_initial_state(1), (state, input) => {
	var bet, vars;
	// var player_count
	// if (!state.deck) {
	// 	if ((player_count = parseInt(input, 10)) > 0 && player_count == Math.floor(player_count)) {
	// 		return create_initial_state(player_count);
	// 	}
	// 	console.log('bad input: number of players must be a positive integer')
	// 	return state;
	// }
	if (input.deck) {
		return input;
	}
	if (input === 'print state') {
		R.forEach(print_player, state.players);
		return state;
	} else if ((vars = input.split(' '))[0] === 'save') {
		 client.setStream(vars[1], JSON.stringify(state))
		.errors(e => console.log('save failed:', e))
		.each(_ => {
			console.log('successfully saved state at:', vars[1])
		})
		return state;
	} else if (state.action === 'bet'){
		if ((bet = parseInt(input, 10)) >= 0 && bet == Math.floor(bet)) {
			if (bet <= state.players[state.current_player].funds ){
				return R.pipe(
					place_bet(bet),
					move_on,
					start_dealing_if_dealer
				)(state);
			}
			console.log('bad input: insufficent funds to bet', bet)
			return state;
		}
		console.log('bad input: bet must be a non-negative integer')
		return state;
	} else if (state.action === 'hit_or_stick'){
		if (input === 'hit'){
			return hit_or_stick(deal(state));
		} else if (input === 'stick'){
			return hit_or_stick(move_on(state));
		} else {
			console.log('bad input: please type "hit" or type "stick"');
			return state;
		}
	}
	console.log('Unexpected input');
	return state;
})
.flatten()
.pluck('current_player')
// .tap(console.log)
.each(_ => null);

console.log('game started please place your bet')