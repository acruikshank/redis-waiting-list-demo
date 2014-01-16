var redisDriver  = require('redis');
var participationPackage = require('../lib/participation');
var assert = require('assert');
var redis, participation;

var SECONDS = 1000;

describe('participation', function(){
  var roomId;

  beforeEach(function() { 
    roomId = generateRoomId();
    redis = redisDriver.createClient(); 
    participation =  participationPackage.Participation(10, redis);
  })
  
  afterEach(function() { 
    redis.quit(); 
  })

  describe('with an empty room', function() {
    it('allows attendees into room', function(done){
      return participation.check(roomId, '1', ex(participationStatus));

      function participationStatus( err, status ) {
        assert.equal(null, err);
        assert.equal('ready', status.status);
        done();
      }
    }, 250);
  })

  describe('when room is below capacity', function() {
    beforeEach(function(done) {
      addUsersToRoom(roomId, userIds(5), done);
    })

    it('allows attendees into room', function(done){
      participation.check(roomId, 'user5', ex(participationStatus));

      function participationStatus( err, status ) {
        assert.equal(null, err);
        assert.equal('ready', status.status);
        done();
      }
    }, 250);
  })

  describe('when room is at or above capacity', function() {
    beforeEach(function(done) {
      addUsersToRoom(roomId, userIds(10), done);
    });

    it('adds attendee to waiting list', function(done){
      participation.check(roomId, 'user10', ex(participationStatus));

      function participationStatus( err, status ) {
        assert.equal(null, err);
        assert.equal('waiting', status.status);
        assert.equal(0, status.rank);
        done();
      }
    }, 250);

    it('allows in existing participants', function(done) {
      participation.check(roomId, 'user3', ex(participationStatus));

      function participationStatus( err, status ) {
        assert.equal(null, err);
        assert.equal('ready', status.status);
        done();
      }
    })

    it('ranks waiting list participants according to when they check in', function(done) {
      checkUsers(roomId, userIds(5, 10), function(statuses) {
        for (var i=10; i<15; i++) {
          assert.equal('waiting', statuses['user'+i].status);
          assert.equal(i-10, statuses['user'+i].rank);
        }
        done();
      })
    })

    describe('when a user leaves the room', function() {
      beforeEach(function(done) {
        checkUsers(roomId, userIds(5, 10), function() {
          redis.hdel(roomId+':participants', 'user0', done);
        })
      });

      it('allows in the next user', function(done) {
        return participation.check(roomId, 'user10', ex(participationStatus));

        function participationStatus( err, status ) {
          assert.equal(null, err);
          assert.equal('ready', status.status);
          done();
        }        
      })

      it('keeps newer users in line', function(done) {
        return participation.check(roomId, 'user12', ex(participationStatus));

        function participationStatus( err, status ) {
          assert.equal(null, err);
          assert.equal('waiting', status.status);
          assert.equal(1, status.rank);
          done();
        }        
      })

      describe('when a new user connects', function(done) {
        beforeEach(function(done) {
          participation.connect(roomId, 'user10', {data:'data'}, done);
        })

        it('adds the user to participants', function(done) {
          return redis.hget(roomId+':participants', 'user10', ex(withUserData));

          function withUserData(err, user) {
            assert.equal(null, err);
            assert.equal('data', JSON.parse(user).data);
            done();
          }
        })

        it('removes the user from the waiting list', function(done) {
          return redis.zrank(roomId+':waiting', 'user10', ex(withRank));

          function withRank(err, rank) {
            assert.equal(null, err);
            assert.equal(null, rank);
            done();
          }          
        })

      })

      describe('when a participant disconnects', function(done) {
        beforeEach(function(done) {
          // create a waiting list
          checkUsers(roomId, userIds(5, 10), ex(thenDisconnect));

          function thenDisconnect() {
            participation.disconnect(roomId, 'user1', 1, verifyDisconnected);
          }

          function verifyDisconnected(err, disconnected) {
            assert.equal(null, err);
            assert.equal(true, disconnected);
            done();
          }
        })

        it('removes user from participant list', function(done) {
          return redis.hget(roomId+':participants', 'user1', ex(withUserData));

          function withUserData(err, user) {
            assert.equal(null, err);
            assert.equal(null, user);
            done();
          }
        })

        it('adds the user to the front of the waiting list', function(done) {
          return participation.check(roomId, 'user1', ex(testStatus));

          function testStatus(err, status) {
            assert.equal(null, err);
            assert.equal('ready', status.status);
            done();
          }
        })
      })

      describe('when a participant disconnects then reconnects immediately', function(done) {
        beforeEach(function(done) {
          // create a waiting list
          checkUsers(roomId, userIds(5, 10), ex(function() {
            done();
          }));
        })

        it('disconnect callback emits false', function(done) {
          participation.disconnect(roomId, 'user1', 100, verifyDisconnected);

          setTimeout(function() {
            participation.connect( roomId, 'user1', {data: 'data'} );
          }, 10);

          function verifyDisconnected(err, disconnected) {
            assert.equal(null, err);
            assert.equal(false, disconnected);
            done();
          }
        })
      })
    })

    describe('when room opens after people have left line', function(done) {
      var clock;

      beforeEach(function(done) {
        // at the end of this sequence, 5 users will add themselves to the waiting list,
        // 3 of them (user 10, 12 and 13) will have checked in, 100 seconds will have 
        // passed, and 2 participants will have dropped out of the room.
        clock = this.clock = ControlClock()
        participation.setClock(clock);
        return checkUsers(roomId, userIds(5, 10), checkIn);

        function checkIn() {
          clock.add(15*SECONDS);
          checkUsers(roomId, ['user10','user12','user13'], ex(dropUsers));
        }

        function dropUsers() {
          redis.multi()
            .hdel(roomId+':participants', 'user0')
            .hdel(roomId+':participants', 'user1')
            .exec(ex(checkIn2));
        }

        function checkIn2() {
          clock.add(10*SECONDS);
          checkUsers(roomId, ['user10','user12','user13'], ex(waitForTimeout));
        }

        function waitForTimeout() {
          clock.add(25*SECONDS)
          done();
        }
      })

      it('lets in users 10 and 12 and puts user 13 in front of line', function(done) {
        checkUsers(roomId, userIds(5, 10), function(statuses) {
          assert.equal('ready', statuses.user10.status);
          assert.equal('ready', statuses.user12.status);

          assert.equal('waiting', statuses.user13.status);
          assert.equal(0, statuses.user13.rank);

          assert.equal('waiting', statuses.user11.status);
          assert.equal(1, statuses.user11.rank);

          assert.equal('waiting', statuses.user14.status);
          assert.equal(2, statuses.user14.rank);
          done();
        })
      })
    })
  })
})

function generateRoomId() {
  for (var i=0,roomId='',r; r=parseInt(Math.random()*36), i<5; i++)
    roomId += r < 10 ? r : String.fromCharCode(87+r);
  return roomId;
}

function ex(f) {
  return function() {
    try {
      f.apply(this,arguments);
    } catch (e) {
      console.log(e.stack)
    }
  }
}

function Serial() {
  var fs = [];
  function call(f) { fs.push(f) }
  function next() { fs.splice(0,1)[0]() }
  function andThen(cb) { call(cb); next() }
  return {call:call, next:next, andThen:andThen};
}

function ControlClock(start) {
  var time = start || new Date().getTime();
  return {
    getTime: function() { return time },
    add: function(ms) { time += ms; }
  }
}

function scope(f) { 
  var a=Array.prototype.slice.call(arguments,1);
  return function() { return f.apply(this, a) } 
}

function addParticipant(roomId, id, done) {
  return function() { redis.hset(roomId+':participants', id, "user info", done) }
}

function addUsersToRoom(roomId, ids, done) {
  var serial = Serial();
  for (var i=0, id; id=ids[i]; i++)
    serial.call(addParticipant(roomId, id, serial.next));
  serial.call(function() { redis.expire(roomId+':participants', 60, serial.next) })
  serial.andThen(done);  
}

function userIds(count, startingWith) {
  for (var i=0,ids=[]; i < count; i++)
    ids.push('user'+(i+(startingWith||0)));
  return ids;
}

function checkUsers( roomId, ids, cb /*( statuses )*/ ) {
  var serial = Serial(), statuses={};
  for (var i=0, id; id = ids[i]; i++)
    serial.call(scope(function(id) { participation.check(roomId, id, function(err,status) {
      statuses[id] = status;
      serial.next();
    }) },id))

  serial.andThen(function() {cb(statuses)})
}
