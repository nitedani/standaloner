import user from 'peer-user';
import wrapper from 'peer-wrapper';
import typed from 'peer-typed';

console.log(`app: peer-dep ${wrapper.depVersion}, ${typed.name}; peer-user: peer-dep ${user.depVersion}, ${user.typed}`);
