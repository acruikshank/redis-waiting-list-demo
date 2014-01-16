var canvas, ctx, room, events, userId, color;

// define socket event handlers
var handlers = {};
var oldPoints = {};

// GRAPHICS
function render(point) {
  ctx.fillStyle = 'rgba(0,0,0,.01)';
  ctx.fillRect( 0, 0, canvas.width, canvas.height);

  var x = canvas.width * point.x;
  var y = canvas.height * point.y;
  var points = (oldPoints[point.id] = oldPoints[point.id] || [])
  points = oldPoints[point.id] = [{x:x, y:y}].concat(points.slice(0,6));

  ctx.strokeStyle = point.color;
  ctx.lineWidth = 2;

  ctx.beginPath();
  for (var i=1,p; p = points[i]; i++){
    ctx.moveTo(x,y);
    ctx.lineTo(p.x,p.y);
  }
  ctx.stroke();
}

// Straight javascript port of formula given here: http://beesbuzz.biz/code/hsv_color_transforms.php
function hsvTransform( color, H, S, V) {
  var VSU = V*S*Math.cos(H*Math.PI/180);
  var VSW = V*S*Math.sin(H*Math.PI/180);
  return {
    r : (.299*V+.701*VSU+.168*VSW)*color.r + (.587*V-.587*VSU+.330*VSW)*color.g + (.114*V-.114*VSU-.497*VSW)*color.b,
    g : (.299*V-.299*VSU-.328*VSW)*color.r + (.587*V+.413*VSU+.035*VSW)*color.g + (.114*V-.114*VSU+.292*VSW)*color.b,
    b : (.299*V-.3*VSU+1.25*VSW)*color.r + (.587*V-.588*VSU-1.05*VSW)*color.g + (.114*V+.886*VSU-.203*VSW)*color.b }
}

function colorToRGBA( color, alpha ) {
  return 'rgba(' + parseInt(color.r*255) + ',' + parseInt(color.g*255) + ',' + parseInt(color.b*255) + ',' + alpha + ')';
}

// SOCKET MESSAGE HANDLERS
handlers.connect = function() {
  events.send('join', {roomId:room, userId:userId});
}

handlers.draw = function( point ) {
  render(point);
}

handlers.count = function( connected ) {
  document.getElementById('connected').innerHTML = connected+' connected';
}

// MOUSE EVENTS
function canvasMove(e) {
  e.preventDefault();
  if ( e.changedTouches && e.changedTouches.length )
    e = e.changedTouches[0]

  events.send( 'draw', {
    room: room,
    id: userId,
    color: colorToRGBA( color, .5 ),
    x: e.pageX / canvas.width, 
    y:(e.pageY - canvas.offsetTop)/ canvas.height
  });
}

// INITIALIZATION
window.onload = function initialize() {
  // our room id and user id are in the document body
  room = document.body.id
  userId = document.body.getAttribute('data-user_id')
  color = hsvTransform( {r:1, g:1, b:.4}, 360*Math.random(), 1, 1);

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
  canvas.onmousemove = canvasMove;
  canvas.addEventListener('touchmove', canvasMove);
}

// manage socket.io communication
function Events() {
  var socket, handlers = {}, connected=false;

  function connect() {
    socket = io.connect();

    socket.on( 'message', function( data ) { 
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
