/*
 * Connect all of your endpoints together here.
 */
var utils = require('./utils.js');

module.exports = function (app, router) {
    // Answer CORS preflight requests (the CORS headers are set in server.js)
    app.use(function (req, res, next) {
        if (req.method === 'OPTIONS') return res.sendStatus(204);
        next();
    });

    require('./home.js')(router);
    require('./users.js')(router);
    require('./tasks.js')(router);
    app.use('/api', router);

    // No route matched
    app.use(function (req, res) {
        utils.send(res, 404, 'Not found: there is no endpoint at ' + req.method + ' ' + req.path, {});
    });

    // Errors thrown by the routes, and request bodies that are not valid JSON
    app.use(function (err, req, res, next) {
        if (err instanceof utils.ApiError) {
            return utils.send(res, err.status, err.message, {});
        }
        if (err.type === 'entity.parse.failed') {
            return utils.send(res, 400, 'The request body is not valid JSON', {});
        }
        // Bad values the routes' own checks missed
        if (err.name === 'ValidationError' || err.name === 'CastError') {
            return utils.send(res, 400, 'The request contains invalid values', {});
        }
        console.error(err);
        utils.send(res, 500, 'Something went wrong on the server, please try again', {});
    });
};
