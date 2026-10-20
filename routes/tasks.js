var Task = require('../models/task.js');
var User = require('../models/user.js');
var utils = require('./utils.js');

// Reads a task from the request body and checks it. Nothing is written until every check passes,
// in the order the README asks for: field values (400), unknown user (404), name mismatch (400).
async function readTask(body) {
    var fields = {
        name: utils.requiredString(body, 'name'),
        description: utils.optionalString(body, 'description', ''),
        deadline: utils.requiredDate(body, 'deadline'),
        completed: utils.optionalBoolean(body, 'completed', false),
        assignedUser: utils.optionalString(body, 'assignedUser', ''),
        assignedUserName: utils.optionalString(body, 'assignedUserName', undefined)
    };

    if (fields.assignedUser === '') {
        if (fields.assignedUserName !== undefined && fields.assignedUserName !== '' &&
            fields.assignedUserName !== 'unassigned') {
            throw new utils.ApiError(400, 'A task without an assignedUser must have assignedUserName "unassigned"');
        }
        fields.assignedUserName = 'unassigned';
        return fields;
    }

    if (!utils.isId(fields.assignedUser)) {
        throw new utils.ApiError(400, 'The assignedUser is not a valid user id');
    }
    var user = await User.findById(fields.assignedUser);
    if (!user) {
        throw new utils.ApiError(404, 'The assigned user does not exist');
    }
    if (fields.assignedUserName === undefined) {
        fields.assignedUserName = user.name;
    } else if (fields.assignedUserName !== user.name) {
        throw new utils.ApiError(400, 'The assignedUserName does not match the name of the assigned user');
    }
    return fields;
}

// Makes the users' pendingTasks agree with the task (see "Two-way references" in the README)
async function syncUsers(task) {
    var taskId = String(task._id);

    // No other user has this task
    var others = { pendingTasks: taskId };
    if (task.assignedUser) others._id = { $ne: task.assignedUser };
    await User.updateMany(others, { $pull: { pendingTasks: taskId } });

    // The assigned user has it while it is pending; a completed task stays assigned but is not pending
    if (task.assignedUser) {
        var update = task.completed ? { $pull: { pendingTasks: taskId } } : { $addToSet: { pendingTasks: taskId } };
        await User.updateOne({ _id: task.assignedUser }, update);
    }
}

module.exports = function (router) {

    var tasksRoute = router.route('/tasks');
    var taskRoute = router.route('/tasks/:id');

    tasksRoute.get(async function (req, res) {
        var result = await utils.listQuery(Task, req.query, 100);
        utils.send(res, 200, 'OK', result);
    });

    tasksRoute.post(async function (req, res) {
        var fields = await readTask(req.body || {});
        var task = new Task(fields);
        await task.save();
        await syncUsers(task);
        utils.send(res, 201, 'Task created', task);
    });

    taskRoute.get(async function (req, res) {
        var task = await utils.findOne(Task, req.params.id, req.query, 'Task');
        utils.send(res, 200, 'OK', task);
    });

    taskRoute.put(async function (req, res) {
        var task = await utils.findOne(Task, req.params.id, {}, 'Task');
        var fields = await readTask(req.body || {});
        task.set(fields);
        await task.save();
        await syncUsers(task);
        utils.send(res, 200, 'Task updated', task);
    });

    taskRoute.delete(async function (req, res) {
        var task = await utils.findOne(Task, req.params.id, {}, 'Task');
        await task.deleteOne();
        await User.updateMany({ pendingTasks: String(task._id) }, { $pull: { pendingTasks: String(task._id) } });
        // 204 No Content: success with an empty body
        res.status(204).end();
    });

    return router;
}
