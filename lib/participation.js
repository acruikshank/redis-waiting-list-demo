/*
  Participation - manages screening participation and waiting lists in redis.
  Check:
    If already a participant: ready, no ticket
    If waitingList dropouts:
      delete all dropouts, recompute rank
    If not waiting:
      If participants + waiting < size: create ticket, ready
      append to waiting, continue (assume rank == waiting)
    If participants + rank < size: create ticket, ready
    update checkin, return waiting size-participants + rank
  
  Connect:
    add participant
    remove ticket, checkin

  Disconnect
    remove participant
    add ticket
 */

var SECONDS = 1000;
var WAITING_LIST_DROPOUT_TIME = 30*SECONDS;
var PARTICIPANT_EXPIRY = 6*60*60;
var SET_EXPIRY = 60*60;

var Q1_PARTICIPANT_COUNT = 0;
var Q1_WAITING_LIST_COUNT = 1;
var Q1_WAITING_LIST_RANK = 2;
var Q1_PARTICIPANT = 3;
var Q1_DROPOUTS = 4;
var Q2_WAITING_LIST_COUNT = 2;
var Q2_WAITING_LIST_RANK = 3;
var Q3_WAITING_LIST_RANK = 4;

var DISCONNECT_BUFFER_TIME = 3*SECONDS;

function participantHash(room) { return room+':participants'; }
function waitingSet(room) { return room+':waiting'; }
function checkinSet(room) { return room+':checkin'; }

function DefaultClock() {
  return { getTime: function() { return new Date().getTime(); } }
}

exports.Participation = function WaitingList( size, redisClient ) {
  var clock = DefaultClock();

	return {    
		check: function( room, uid, cb ) {
      var participants, waiting, rank;

      // fetch size of screening and waiting list
      redisClient.multi()
        .hlen(participantHash(room))
        .zcard(waitingSet(room))
        .zrank(waitingSet(room), uid)
        .hget(participantHash(room), uid)
        .zrangebyscore(checkinSet(room), 0, clock.getTime() - WAITING_LIST_DROPOUT_TIME )
        .exec(withParticipantCount);

      function withParticipantCount(err, responses) {
        if (err) return cb(err);
        participants = responses[Q1_PARTICIPANT_COUNT];
        waiting = responses[Q1_WAITING_LIST_COUNT];

        if (responses[Q1_PARTICIPANT])
          return readyStatus();

        if (participants + waiting < size)
          return readyStatus();

        // remove dropouts, then recalculate rank
        if (responses[Q1_DROPOUTS] && responses[Q1_DROPOUTS].length)
          return redisClient.multi()
            .zrem([checkinSet(room)].concat(responses[Q1_DROPOUTS]))
            .zrem([waitingSet(room)].concat(responses[Q1_DROPOUTS]))
            .zcard(waitingSet(room))
            .zrank(waitingSet(room), uid)
            .exec(withNewRank);

        rank = responses[Q1_WAITING_LIST_RANK];
        if (rank != null && participants + rank < size)
          return addTicket();

        return updateWaitingStatus()
      }

      function withNewRank(err, responses) {
        waiting = responses[Q2_WAITING_LIST_COUNT];
        if (participants + waiting < size)
          return readyStatus();

        rank = responses[Q2_WAITING_LIST_RANK];
        if (rank != null && participants + rank < size)
          return addTicket();

        return updateWaitingStatus();
      }

      function updateWaitingStatus() {
        // find current highest score
        if (rank == null) 
          return redisClient.zrange(waitingSet(room), -1, -1, 'WITHSCORES', addToWaitingList);

        return redisClient.multi()
          .zadd(checkinSet(room), clock.getTime(), uid)
          .expire(checkinSet(room), SET_EXPIRY)
          .exec(waitingStatus);
      }

      function addToWaitingList(err, lastInLine) {
        if (err) return cb(err);
        score = parseInt((lastInLine||[])[1]||0) + 1;
        return redisClient.multi()
          .zadd(waitingSet(room), score, uid)
          .expire(waitingSet(room), SET_EXPIRY)
          .zadd(checkinSet(room), clock.getTime(), uid)
          .expire(checkinSet(room), SET_EXPIRY)
          .zrank(waitingSet(room), uid)
          .exec(waitingStatus)
      }

      function addTicket() {
        return redisClient.multi()
          .zadd(waitingSet(room), 0, uid) // setting score to 0 = creating ticket
          .expire(waitingSet(room), SET_EXPIRY)
          .zadd(checkinSet(room), clock.getTime(), uid)
          .expire(checkinSet(room), SET_EXPIRY)
          .exec(readyStatus)
      }

      function readyStatus() {
        return cb(null, {status:'ready'});
      }

      function waitingStatus(err, responses) {
        if (err) return cb(err);
        if (responses && responses[Q3_WAITING_LIST_RANK] != null)
          rank = responses[Q3_WAITING_LIST_RANK];
        return cb(null, {status:'waiting', rank:  Math.max(0,rank - (size-participants)) })
      }
		},

    connect: function(room, uid, user, cb) { 
      return redisClient.multi()
        .hset(participantHash(room), uid, JSON.stringify(user))
        .expire(participantHash(room), PARTICIPANT_EXPIRY)
        .zrem(waitingSet(room), uid)
        .exec(cb||function() {})
    },

    disconnect: function(room, uid, disconnectBufferTime, cb) {
      return redisClient.multi()
        .hdel(participantHash(room), uid)
        .zadd(waitingSet(room), 0, uid) // setting score to 0 = creating ticket
        .expire(waitingSet(room), SET_EXPIRY)
        .zadd(checkinSet(room), clock.getTime() - WAITING_LIST_DROPOUT_TIME/2, uid)
        .expire(checkinSet(room), SET_EXPIRY)
        .exec(checkForUserReconnect);

      function checkForUserReconnect() {
        disconnectBufferTime = disconnectBufferTime || DISCONNECT_BUFFER_TIME;

        setTimeout(function() {
          return redisClient.multi()
            .hexists(participantHash(room), uid)
            .exec(handleDisconnect);
        }, disconnectBufferTime);

        function handleDisconnect(err, results) {
          if (cb)
            cb(err, (results && !results[0]));
        }
      }
    },

    // count the participants in the room
    count: function(room, cb) {
      return redisClient.hlen(participantHash(room), cb);
    },

    // return the list of participants in the room
    participants: function(room, cb) {
      return redisClient.hvals(participantHash(room), cb);
    },

    // for testing
    setClock: function(newClock) {
      clock = newClock;
    }
	}
}
