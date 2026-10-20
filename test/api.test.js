// End-to-end tests for the API, run with `npm test`.
// Starts server.js on a random port, talks to it over HTTP (using the database in .env)
// and deletes everything it created at the end.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 30000 + Math.floor(Math.random() * 10000);
const BASE = `http://localhost:${PORT}/api`;
const RUN = Date.now().toString(36);
const MISSING_ID = '5f0000000000000000000000';

let server;
const created = { users: [], tasks: [] };
let n = 0;

async function api(method, url, body) {
    const res = await fetch(BASE + url, {
        method,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    const json = text === '' ? null : JSON.parse(text);
    if (res.status === 204) {
        assert.equal(text, '', `${method} ${url}: a 204 should have an empty body`);
    } else {
        assert.equal(typeof json.message, 'string', `${method} ${url}: message should be a string`);
        assert.ok('data' in json, `${method} ${url}: response should have data`);
    }
    return { status: res.status, body: json, data: json && json.data };
}

const q = (obj) => encodeURIComponent(JSON.stringify(obj));
const email = () => `test-${RUN}-${++n}@example.com`;

async function makeUser(extra = {}) {
    const res = await api('POST', '/users', { name: `User ${RUN} ${++n}`, email: email(), ...extra });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    created.users.push(res.data._id);
    return res.data;
}

async function makeTask(extra = {}) {
    const res = await api('POST', '/tasks', { name: `Task ${RUN} ${++n}`, deadline: '2030-01-01', ...extra });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    created.tasks.push(res.data._id);
    return res.data;
}

const getUser = async (id) => (await api('GET', `/users/${id}`)).data;
const getTask = async (id) => (await api('GET', `/tasks/${id}`)).data;

before(async () => {
    server = spawn(process.execPath, ['server.js'], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, PORT: String(PORT) },
        stdio: ['ignore', 'ignore', 'inherit']
    });
    for (let i = 0; i < 50; i++) {
        try { await fetch(BASE); return; } catch { await new Promise((r) => setTimeout(r, 200)); }
    }
    throw new Error('server did not start');
});

after(async () => {
    for (const id of created.tasks) await api('DELETE', `/tasks/${id}`).catch(() => {});
    for (const id of created.users) await api('DELETE', `/users/${id}`).catch(() => {});
    server.kill();
});

describe('creating and validating users', () => {
    it('creates a user with defaults and a server-set dateCreated', async () => {
        const res = await api('POST', '/users', { name: 'Alice', email: email(), dateCreated: '2000-01-01' });
        assert.equal(res.status, 201);
        created.users.push(res.data._id);
        assert.equal(res.data.name, 'Alice');
        assert.deepEqual(res.data.pendingTasks, []);
        assert.ok(new Date(res.data.dateCreated).getFullYear() > 2000, 'client dateCreated is ignored');
    });

    it('rejects missing or wrongly typed name/email with 400', async () => {
        assert.equal((await api('POST', '/users', { email: email() })).status, 400);
        assert.equal((await api('POST', '/users', { name: 'No Email' })).status, 400);
        assert.equal((await api('POST', '/users', { name: 123, email: email() })).status, 400);
        assert.equal((await api('POST', '/users', {})).status, 400);
    });

    it('rejects a duplicate email with 400', async () => {
        const user = await makeUser();
        assert.equal((await api('POST', '/users', { name: 'Copy', email: user.email })).status, 400);
    });

    it('checks pendingTasks: not a list 400, bad id 400, unknown 404, completed 400', async () => {
        const done = await makeTask({ completed: true });
        assert.equal((await api('POST', '/users', { name: 'A', email: email(), pendingTasks: 'abc' })).status, 400);
        assert.equal((await api('POST', '/users', { name: 'A', email: email(), pendingTasks: ['abc'] })).status, 400);
        assert.equal((await api('POST', '/users', { name: 'A', email: email(), pendingTasks: [MISSING_ID] })).status, 404);
        assert.equal((await api('POST', '/users', { name: 'A', email: email(), pendingTasks: [done._id] })).status, 400);
    });

    it('rejects a malformed JSON body with 400', async () => {
        const res = await fetch(BASE + '/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
        assert.equal(res.status, 400);
    });
});

describe('creating and validating tasks', () => {
    it('creates a task with defaults', async () => {
        const task = await makeTask();
        assert.equal(task.description, '');
        assert.equal(task.completed, false);
        assert.equal(task.assignedUser, '');
        assert.equal(task.assignedUserName, 'unassigned');
        assert.ok(task.dateCreated);
    });

    it('accepts a deadline in milliseconds', async () => {
        const task = await makeTask({ deadline: 1893456000000 });
        assert.equal(new Date(task.deadline).getTime(), 1893456000000);
    });

    it('rejects missing/invalid name, deadline or completed with 400', async () => {
        assert.equal((await api('POST', '/tasks', { deadline: '2030-01-01' })).status, 400);
        assert.equal((await api('POST', '/tasks', { name: 'No deadline' })).status, 400);
        assert.equal((await api('POST', '/tasks', { name: 'T', deadline: 'not a date' })).status, 400);
        assert.equal((await api('POST', '/tasks', { name: 'T', deadline: '2030-01-01', completed: 'yes' })).status, 400);
    });

    it('checks assignedUser: bad id 400, unknown 404, name mismatch 400, name filled in', async () => {
        const user = await makeUser();
        const base = { name: 'T', deadline: '2030-01-01' };
        assert.equal((await api('POST', '/tasks', { ...base, assignedUser: 'abc' })).status, 400);
        assert.equal((await api('POST', '/tasks', { ...base, assignedUser: MISSING_ID })).status, 404);
        assert.equal((await api('POST', '/tasks', { ...base, assignedUser: user._id, assignedUserName: 'Someone else' })).status, 400);
        assert.equal((await api('POST', '/tasks', { ...base, assignedUserName: 'Someone' })).status, 400);
        const task = await makeTask({ assignedUser: user._id });
        assert.equal(task.assignedUserName, user.name);
    });

    it('adds a pending assigned task to the user, but not a completed one', async () => {
        const user = await makeUser();
        const pending = await makeTask({ assignedUser: user._id, assignedUserName: user.name });
        const done = await makeTask({ assignedUser: user._id, completed: true });
        assert.deepEqual((await getUser(user._id)).pendingTasks, [pending._id]);
        assert.equal(done.assignedUser, user._id);
    });
});

describe('GET with query parameters', () => {
    let tasks;
    before(async () => {
        tasks = [
            await makeTask({ name: `Q ${RUN} b`, completed: true }),
            await makeTask({ name: `Q ${RUN} a` }),
            await makeTask({ name: `Q ${RUN} c` })
        ];
    });
    const mine = { name: { $regex: `^Q ${RUN}` } };

    it('where, sort, skip and limit together', async () => {
        const res = await api('GET', `/tasks?where=${q(mine)}&sort=${q({ name: 1 })}&skip=1&limit=1`);
        assert.equal(res.status, 200);
        assert.deepEqual(res.data.map((t) => t.name), [`Q ${RUN} b`]);
    });

    it('where with $in and with booleans', async () => {
        const ids = [tasks[0]._id, tasks[2]._id];
        assert.equal((await api('GET', `/tasks?where=${q({ _id: { $in: ids } })}`)).data.length, 2);
        const done = await api('GET', `/tasks?where=${q({ ...mine, completed: true })}`);
        assert.deepEqual(done.data.map((t) => t._id), [tasks[0]._id]);
    });

    it('count', async () => {
        assert.equal((await api('GET', `/tasks?where=${q(mine)}&count=true`)).data, 3);
    });

    it('select on the list and on /:id', async () => {
        const list = await api('GET', `/tasks?where=${q(mine)}&select=${q({ name: 1, _id: 0 })}`);
        assert.deepEqual(Object.keys(list.data[0]), ['name']);
        const one = await api('GET', `/tasks/${tasks[0]._id}?select=${q({ name: 1 })}`);
        assert.deepEqual(Object.keys(one.data).sort(), ['_id', 'name']);
        const ignored = await api('GET', `/tasks/${tasks[0]._id}?where=${q({ name: 'nope' })}`);
        assert.equal(ignored.status, 200);
    });

    it('no match is 200 with an empty list, bad JSON is 400', async () => {
        const none = await api('GET', `/users?where=${q({ _id: MISSING_ID })}`);
        assert.equal(none.status, 200);
        assert.deepEqual(none.data, []);
        assert.equal((await api('GET', '/users?where={bad')).status, 400);
        assert.equal((await api('GET', '/tasks?limit=abc')).status, 400);
    });

    it('unknown or malformed /:id is 404', async () => {
        assert.equal((await api('GET', `/users/${MISSING_ID}`)).status, 404);
        assert.equal((await api('GET', '/tasks/abc')).status, 404);
    });
});

describe('updating missing resources', () => {
    it('PUT on an unknown or malformed id is 404, even with a bad body', async () => {
        assert.equal((await api('PUT', `/users/${MISSING_ID}`, { name: 'X', email: email() })).status, 404);
        assert.equal((await api('PUT', '/users/abc', {})).status, 404);
        assert.equal((await api('PUT', `/tasks/${MISSING_ID}`, { name: 'X', deadline: '2030-01-01' })).status, 404);
        assert.equal((await api('PUT', '/tasks/abc', {})).status, 404);
    });
});

describe('two-way references', () => {
    it('PUT /users replaces pendingTasks: removed tasks are unassigned, added ones assigned', async () => {
        const user = await makeUser();
        const t1 = await makeTask();
        const t2 = await makeTask();
        await api('PUT', `/users/${user._id}`, { name: user.name, email: user.email, pendingTasks: [t1._id] });
        assert.equal((await getTask(t1._id)).assignedUser, user._id);

        const res = await api('PUT', `/users/${user._id}`, { name: user.name, email: user.email, pendingTasks: [t2._id] });
        assert.equal(res.status, 200);
        assert.deepEqual(res.data.pendingTasks, [t2._id]);
        assert.equal(res.data.dateCreated, user.dateCreated);
        const old = await getTask(t1._id);
        assert.equal(old.assignedUser, '');
        assert.equal(old.assignedUserName, 'unassigned');
        assert.equal((await getTask(t2._id)).assignedUserName, user.name);
    });

    it('a task in another user\'s pendingTasks moves', async () => {
        const a = await makeUser();
        const b = await makeUser();
        const task = await makeTask({ assignedUser: a._id });
        await api('PUT', `/users/${b._id}`, { name: b.name, email: b.email, pendingTasks: [task._id] });
        assert.deepEqual((await getUser(a._id)).pendingTasks, []);
        assert.deepEqual((await getUser(b._id)).pendingTasks, [task._id]);
        assert.equal((await getTask(task._id)).assignedUser, b._id);
    });

    it('renaming a user renames all their tasks, completed ones too', async () => {
        const user = await makeUser();
        const pending = await makeTask({ assignedUser: user._id });
        const done = await makeTask({ assignedUser: user._id, completed: true });
        await api('PUT', `/users/${user._id}`, { name: 'Renamed', email: user.email, pendingTasks: [pending._id] });
        assert.equal((await getTask(pending._id)).assignedUserName, 'Renamed');
        assert.equal((await getTask(done._id)).assignedUserName, 'Renamed');
        assert.equal((await getTask(done._id)).assignedUser, user._id);
    });

    it('PUT /users keeps its own email, and missing pendingTasks means none', async () => {
        const user = await makeUser();
        const task = await makeTask({ assignedUser: user._id });
        const res = await api('PUT', `/users/${user._id}`, { name: user.name, email: user.email });
        assert.equal(res.status, 200);
        assert.deepEqual(res.data.pendingTasks, []);
        assert.equal((await getTask(task._id)).assignedUser, '');
    });

    it('PUT /users with another user\'s email is 400', async () => {
        const a = await makeUser();
        const b = await makeUser();
        assert.equal((await api('PUT', `/users/${b._id}`, { name: b.name, email: a.email })).status, 400);
    });

    it('a failed PUT changes nothing', async () => {
        const user = await makeUser();
        const t1 = await makeTask({ assignedUser: user._id });
        const done = await makeTask({ completed: true });
        const res = await api('PUT', `/users/${user._id}`, { name: 'Changed', email: user.email, pendingTasks: [done._id] });
        assert.equal(res.status, 400);
        const after = await getUser(user._id);
        assert.equal(after.name, user.name);
        assert.deepEqual(after.pendingTasks, [t1._id]);
        assert.equal((await getTask(t1._id)).assignedUser, user._id);
    });

    it('PUT /tasks: completing removes from pendingTasks but stays assigned; reopening adds back', async () => {
        const user = await makeUser();
        const task = await makeTask({ assignedUser: user._id });
        const body = { name: task.name, deadline: task.deadline, assignedUser: user._id, assignedUserName: user.name };

        const done = await api('PUT', `/tasks/${task._id}`, { ...body, completed: true });
        assert.equal(done.status, 200);
        assert.equal(done.data.assignedUser, user._id);
        assert.deepEqual((await getUser(user._id)).pendingTasks, []);

        await api('PUT', `/tasks/${task._id}`, { ...body, completed: false });
        assert.deepEqual((await getUser(user._id)).pendingTasks, [task._id]);
    });

    it('PUT /tasks: changing assignedUser moves it, "" unassigns it, missing fields reset', async () => {
        const a = await makeUser();
        const b = await makeUser();
        const task = await makeTask({ assignedUser: a._id, description: 'keep?' });

        await api('PUT', `/tasks/${task._id}`, { name: task.name, deadline: task.deadline, assignedUser: b._id });
        assert.deepEqual((await getUser(a._id)).pendingTasks, []);
        assert.deepEqual((await getUser(b._id)).pendingTasks, [task._id]);

        const res = await api('PUT', `/tasks/${task._id}`, { name: task.name, deadline: task.deadline, assignedUser: '' });
        assert.equal(res.data.assignedUserName, 'unassigned');
        assert.equal(res.data.description, '');
        assert.equal(res.data.dateCreated, task.dateCreated);
        assert.deepEqual((await getUser(b._id)).pendingTasks, []);
    });

    it('PUT /tasks can reassign a completed task without making it pending', async () => {
        const a = await makeUser();
        const b = await makeUser();
        const task = await makeTask({ assignedUser: a._id, completed: true });
        const res = await api('PUT', `/tasks/${task._id}`, { name: task.name, deadline: task.deadline, completed: true, assignedUser: b._id });
        assert.equal(res.status, 200);
        assert.equal(res.data.assignedUserName, b.name);
        assert.deepEqual((await getUser(b._id)).pendingTasks, []);
    });
});

describe('deleting', () => {
    it('DELETE /tasks removes the task from its user', async () => {
        const user = await makeUser();
        const task = await makeTask({ assignedUser: user._id });
        assert.equal((await api('DELETE', `/tasks/${task._id}`)).status, 204);
        assert.equal((await api('GET', `/tasks/${task._id}`)).status, 404);
        assert.deepEqual((await getUser(user._id)).pendingTasks, []);
        assert.equal((await api('DELETE', `/tasks/${task._id}`)).status, 404);
    });

    it('DELETE /users unassigns all their tasks, completed ones too', async () => {
        const user = await makeUser();
        const pending = await makeTask({ assignedUser: user._id });
        const done = await makeTask({ assignedUser: user._id, completed: true });
        assert.equal((await api('DELETE', `/users/${user._id}`)).status, 204);
        assert.equal((await api('GET', `/users/${user._id}`)).status, 404);
        for (const id of [pending._id, done._id]) {
            const task = await getTask(id);
            assert.equal(task.assignedUser, '');
            assert.equal(task.assignedUserName, 'unassigned');
        }
        assert.equal((await api('DELETE', '/users/abc')).status, 404);
    });
});
