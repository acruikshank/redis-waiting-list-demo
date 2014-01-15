var cluster = require( "cluster" )
var os = require( "os" );
var express = require( "express" );
var http = require( "http" );
var sockets = require( "socket.io" );
var redis = require( "redis" );
var sessions = require( "cookie-sessions" );

// create server cluster
if (cluster.isMaster) {

  var numCPUs = os.cpus().length;
  for (var i = 0; i < numCPUs; i++)
    cluster.fork();

  cluster.on('exit', function(worker, code, signal) {
    console.log('worker ' + worker.process.pid + ' died');
    cluster.fork();
  });

} else {

  // create express application
  var app = express();
  app.configure(function() {
    app.set( 'views', __dirname + '/views/' );
    app.set( 'view engine', 'jade' );

    app.use( express.static(__dirname + '/public') );
    app.use( sessions( { secret: "careful this isn't really secret", session_key: '_redis-waiting-list' } ) );
  });

  var applicationServer = http.createServer(app);

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

  // Simple socket handler
  io.sockets.on( 'connection', function( socket ) {
    console.log("GOT CONNECTION")
    socket.on( 'message', function( message ) {
      console.log("MESSAGE", message)
      for ( var type in message )
        if ( type === 'join' )
          socket.join(message[type]);
        else if (message[type].room)
          io.sockets.in(message[type].room).json.emit('message',message);
    } );

    socket.on( 'disconnect', function( message ) {
      /*
       participation.disconnect(socket.screening_id, socket.user_id, null, handleDisconnect);

      function handleDisconnect(err, disconnected) {
        if (!disconnected)
          return;

        exports.broadcast( { disconnected : socket.user_id }, socket.screening_id );
      }
      */
    } );
  } );


  var redisClient = redis.createClient();

  // Handle default route
  app.get("/", function( request, response ) {
    return response.render( 'index' );
  });

  // Handle room
  app.get("/:room", function( request, response) {
    return response.render( 'room', {id:request.params.room} );
  });

  applicationServer.listen( 8234 );
  console.log( "Listening on port 8234" );
}