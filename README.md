redis-waiting-list
==================

A demonstration project using Redis to maintain a realtime waiting list when participation in a room exceeds a given limit. Read the
blog post at http://blog.carbonfive.com/2014/01/17/using-redis-sorted-sets-to-build-a-scalable-real-time-web-waiting-list/.

## Installation and running
To run the demo, make sure you have recent versions of [Node.js](http://nodejs.org) and [Redis](http://redis.io/download) installed
on your machine. Redis needs to be running on the default port with no authentication.

From the project directory, run:
<pre>
npm install
npm start
</pre>

You should now be able to connect to the server at http://localhost:8234, follow the instructions from there.

## Testing
The project only tests the core waiting list logic. Make sure [Mocha](http://mochajs.org/) is installed on
your machine and run:
<pre>
mocha test
</pre>
