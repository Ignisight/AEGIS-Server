fetch('https://attendance-server-ddgs.onrender.com/api/admin/wipe-student-data', {
  method: 'POST',
  headers: {
    'x-app-secret': '1D3B89B487F52',
    'Content-Type': 'application/json'
  }
})
.then(res => res.json())
.then(data => {
  console.log(data);
  process.exit(0);
})
.catch(err => {
  console.error(err);
  process.exit(1);
});
