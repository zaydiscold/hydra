import { prisma } from './server/services/db.js';
import DashboardController from './server/controllers/DashboardController.js';

async function run() {
  const u = await prisma.user.findFirst();
  try {
    const res = await fetch('http://localhost:3000/api/dashboard', {
      headers: {
        'Cookie': 'bypass=1' // won't work easily if auth is locked
      }
    }); // Just mock req/res
  } catch (err) {}
  
  // Directly call controller method
  let sentData;
  const req = { user: { id: u.id } };
  const res = {
    status: (s) => ({
      json: (d) => { console.log('STATUS:', s, 'DATA:', JSON.stringify(d, null, 2)); sentData = d; }
    })
  };
  await DashboardController.getDashboard(req, res);
}
run().then(()=>process.exit(0)).catch(e=>{console.error("THROWN:", e);process.exit(1)});
