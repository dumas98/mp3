var User = require('../models/user.js');
var Task = require('../models/task.js');
var utils = require('./utils.js');

// Reads a user from the request body and checks it. Nothing is written until every check passes,
// in the order the README asks for: field values (400), email taken (400), unknown task (404), completed task (400).
async function readUser(body, userId) {
    var fields = {
        name: utils.requiredString(body, 'name'),
        email: utils.requiredString(body, 'email'),
        pendingTasks: utils.optionalIdList(body, 'pendingTasks')
    };

    var sameEmail = { email: fields.email };
    if (userId) sameEmail._id = { $ne: userId };
    if (await User.exists(sameEmail)) {
        throw new utils.ApiError(400, 'Another user already uses this email');
    }

    var tasks = await Task.find({ _id: { $in: fields.pendingTasks } });
    if (tasks.length !== fields.pendingTasks.length) {
        throw new utils.ApiError(404, 'A task in pendingTasks does not exist');
    }
    if (tasks.some(function (task) { return task.completed; })) {
        throw new utils.ApiError(400, 'A completed task cannot be in pendingTasks');
    }
    return fields;
}

async function saveUser(user) {
    try {
        await user.save();
    } catch (err) {
        // Two requests created the same email at the same time
        if (err.code === 11000) throw new utils.ApiError(400, 'Another user already uses this email');
        throw err;
    }
}

// Makes the tasks agree with the user's new pendingTasks (see "Two-way references" in the README)
async function syncTasks(user, oldPendingTasks) {
    var userId = String(user._id);
    var pending = user.pendingTasks;

    // Tasks the user no longer has become unassigned
    var removed = oldPendingTasks.filter(function (id) { return !pending.includes(id); });
    await Task.updateMany({ _id: { $in: removed }, assignedUser: userId },
        { assignedUser: '', assignedUserName: 'unassigned' });

    // Tasks the user now has are taken away from any other user, then assigned to this one
    await User.updateMany({ _id: { $ne: user._id }, pendingTasks: { $in: pending } },
        { $pull: { pendingTasks: { $in: pending } } });
    await Task.updateMany({ _id: { $in: pending } }, { assignedUser: userId, assignedUserName: user.name });

    // All of the user's tasks, completed ones too, carry the user's current name
    await Task.updateMany({ assignedUser: userId }, { assignedUserName: user.name });
}

module.exports = function (router) {

    var usersRoute = router.route('/users');
    var userRoute = router.route('/users/:id');

    usersRoute.get(async function (req, res) {
        var result = await utils.listQuery(User, req.query, undefined);
        utils.send(res, 200, 'OK', result);
    });

    usersRoute.post(async function (req, res) {
        var fields = await readUser(req.body || {}, null);
        var user = new User(fields);
        await saveUser(user);
        await syncTasks(user, []);
        utils.send(res, 201, 'User created', user);
    });

    userRoute.get(async function (req, res) {
        var user = await utils.findOne(User, req.params.id, req.query, 'User');
        utils.send(res, 200, 'OK', user);
    });

    userRoute.put(async function (req, res) {
        var user = await utils.findOne(User, req.params.id, {}, 'User');
        var fields = await readUser(req.body || {}, user._id);
        var oldPendingTasks = user.pendingTasks.slice();
        user.set(fields);
        await saveUser(user);
        await syncTasks(user, oldPendingTasks);
        utils.send(res, 200, 'User updated', user);
    });

    userRoute.delete(async function (req, res) {
        var user = await utils.findOne(User, req.params.id, {}, 'User');
        await user.deleteOne();
        await Task.updateMany({ assignedUser: String(user._id) }, { assignedUser: '', assignedUserName: 'unassigned' });
        utils.send(res, 200, 'User deleted', user);
    });

    return router;
}
