import dep from 'peer-dep';
import user from 'peer-user';
import wrapper from 'peer-wrapper';
import typed from 'peer-typed';

console.log(`app: peer-dep ${dep.version}/${wrapper.depVersion}, ${typed.name}; peer-user: peer-dep ${user.depVersion}, ${user.typed}`);
