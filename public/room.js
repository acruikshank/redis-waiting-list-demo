var canvas, ctx, room, events;

// define socket event handlers
var handlers = {}

handlers.connect = function() {
  console.log("CONNECTING")
  events.send('join', room);
}

handlers.draw = function( coords ) {
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc( canvas.width * coords.x, canvas.height * coords.y, 10, 0, 2*Math.PI, true);
  ctx.fill();
}

// mouse events
function canvasClick(e) {
  events.send( 'draw', {
    room: room,
    x: e.clientX / canvas.width, 
    y:(e.clientY - canvas.offsetTop)/ canvas.height
  });
}

// initialize the app
window.onload = function initialize() {
  // our room id is the id of the document body
  room = document.body.id

  // connect socket
  events = Events();
  events.connect();

  // register socket handlers
  events.on( handlers );

  // initialize the canvas
  canvas = document.getElementById('show')
  canvas.width = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  ctx = canvas.getContext('2d');

  // register mouse events
  canvas.onclick = canvasClick
}

// manage socket.io communication
function Events() {
  var socket, handlers = {}, connected=false;

  function connect() {
    socket = io.connect();

    socket.on( 'message', function( data ) { 
      console.log("GOT MESSAGE", data)
      for( var type in data )
        if( type in handlers )
          for ( var i=0,h=handlers[type],l=h.length; i < l; i++ ) h[i]( data[type] );
    });

    socket.on( 'connect', function( data ) {
      if ( 'connect' in handlers )
        for (var i=0,handler; handler = handlers.connect[i]; i++ ) handler( data );
      connected = true;
    } );

    socket.on( 'reconnect', function( data ) {
      if ( 'reconnect' in handlers )
        for (var i=0,handler; handler = handlers.reconnect[i]; i++ ) handler( data );
    } );
  }

  function send( event, message ) {
    payload = {}
    payload[event] = message || {};
    socket.emit( 'message', payload );
  }

  function on( newHandlers ) {
    for( var t in newHandlers )
      (handlers[t] = handlers[t] || []).push( newHandlers[t] );
  }

  return { send:send, on:on, connect:connect };
}
