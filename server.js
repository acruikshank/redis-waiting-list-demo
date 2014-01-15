var cluster = require( "cluster" )
var os = require( "os" );
var express = require( "express" );
var http = require( "http" );
var sockets = require( "socket.io" );
var redis = require( "redis" );
var sessions = require( "cookie-sessions" );

var participationModule = require('./lib/participation')

/*************************
 * Cluster
 *************************/

if (cluster.isMaster) {

  var numCPUs = os.cpus().length;
  for (var i = 0; i < numCPUs; i++)
    cluster.fork();

  cluster.on('exit', function(worker, code, signal) {
    console.log('worker ' + worker.process.pid + ' died');
    cluster.fork();
  });

} else {

  /***************************************
   * HTTP Request Communication
   ***************************************/

  var app = express();

  // Use this to control how many people are allowed in a room.
  var MAXIMUM_ROOM_SIZE = 2;

  // Create participation object to track room capacity. 
  var participation = participationModule.Participation( MAXIMUM_ROOM_SIZE, redis.createClient() );

  //************ MIDDLEWARE **************

  app.configure(function() {
    app.set( 'views', __dirname + '/views/' );
    app.set( 'view engine', 'jade' );

    app.use( express.static(__dirname + '/public') );
    app.use( sessions( { secret: "careful this isn't really secret", session_key: '_redis-waiting-list' } ) );
  });

  /* Make sure the user has an id */
  function checkId( request, response, next ) {
    if ( ! request.session )
      request.session = {}

    if ( ! request.session.id ) {
      // generate random string
      for (var i=0,sessionId='',r; r=parseInt(Math.random()*36), i<5; i++)
        sessionId += r < 10 ? r : String.fromCharCode(87+r);

      request.session.id = sessionId;
    }

    next();
  }

  /* Check participation to see if the room is full.
     If it is, direct user to the 'waiting_room' page instead. */
  function checkCapacity( request, response, next ) {
    return participation.check( request.params.room, request.session.id, withStatus );

    function withStatus( err, status ) {
      if (err) 
        return next(err);

      if (status && status.status === 'ready') 
        return next();
      
      return response.render('waiting_room', {id:request.params.room, status:status} )
    }
  }

  //************* ROUTES ********************

  // Handle default route
  app.get("/", function( request, response ) {
    return response.render( 'index' );
  });

  // Handle room
  app.get("/:room", checkId, checkCapacity, function( request, response) {
    return response.render( 'room', {id:request.params.room, userId:request.session.id} );
  });

  //********** START SERVER *****************
  
  var applicationServer = http.createServer(app);
  applicationServer.listen( 8234 );
  console.log( "Listening on port 8234" );


  /*************************
   * Web Socket Communication
   *************************/

  // Initialize socket.io using redis store
  var io = sockets.listen( applicationServer );
  io.set( 'log level', 2 );

  // Use redis store to support multi-process/server communication
  var RedisStore = require('socket.io/lib/stores/redis');
  io.set('store', new RedisStore({
    redisPub : redis.createClient(),
    redisSub : redis.createClient(),
    redisClient : redis.createClient()
  }));

  // Use join message to register as a participant
  function join( socket, message ) {
    socket.join(message.room);
    participation.connect(message.roomId, message.userId, null);

    // use socket to track state
    socket.roomId = message.roomId;
    socket.userId = message.userId;
  }

  io.sockets.on( 'connection', function( socket ) {
    socket.on( 'message', function( message ) {
      for ( var type in message )
        if ( type === 'join' )
          join( socket, message[type] );
        else if (message[type].room)
          io.sockets.in(message[type].room).json.emit('message',message);
    } );

    socket.on( 'disconnect', function() {
      // disconnect from room
      if (socket.roomId)
         participation.disconnect(socket.roomId, socket.userId, null);
    } );
  } );

}