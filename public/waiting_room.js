
// request status from the server
function checkStatus() {
  $.getJSON('/'+document.body.id+'/waiting-list', handleStatus); 
} 

// reload the page if we are ready, or update the status message if not.
function handleStatus( check ) {
  if ( check.status === 'ready' ) {
    window.location.href = window.location.href; // reload
  } else {
    var status;
    if ( check.rank === 0 )
      status = 'You are next in line.';
    else if ( check.rank === 1 )
      status = 'There is 1 person ahead of you.';
    else
      status = 'There are ' + check.rank + ' people ahead of you.';

    $('.status').html(status);
  }
}

// check status every 10 seconds
setInterval( checkStatus, 10*1000 );
