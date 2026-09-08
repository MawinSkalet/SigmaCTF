import {test,expect} from '@playwright/test';
test('register, filter, download and solve RSA, then verify Aura and scoreboard',async({page})=>{
  await page.goto('/');await expect(page.getByRole('heading',{name:'Choose your battleground.'})).toBeVisible();
  await page.getByRole('button',{name:'Enter the arena'}).click();
  const username=`sigma_${Date.now()}`;await page.getByLabel('HANDLE',{exact:true}).fill(username);await page.getByLabel('PASSWORD',{exact:true}).fill('correct horse battery sigma');await page.getByRole('button',{name:'Create account',exact:true}).click();
  await expect(page.getByText(username,{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Crypto',exact:true}).click();await expect(page.getByRole('button',{name:'Open Baby RSA from Ohio'})).toBeVisible();await expect(page.getByRole('button',{name:'Open Ping of Ohio'})).toHaveCount(0);
  await page.getByRole('button',{name:'Open Baby RSA from Ohio'}).click();
  const download=await page.request.get('/api/challenges/baby-rsa/artifact');expect(download.ok()).toBeTruthy();
  const cipher=BigInt((await download.text()).match(/^c = (\d+)/m)![1]);let low=0n,high=cipher;while(low<high){const mid=(low+high+1n)/2n;if(mid**3n<=cipher)low=mid;else high=mid-1n;}expect(low**3n).toBe(cipher);
  let hex=low.toString(16);if(hex.length%2)hex='0'+hex;const flag=Buffer.from(hex,'hex').toString();
  await page.getByLabel('CAPTURE THE FLAG',{exact:true}).fill('sigma{wrong}');await page.getByRole('button',{name:'Submit flag',exact:true}).click();await expect(page.getByRole('status')).toContainText('Skill Issue');
  await page.getByLabel('CAPTURE THE FLAG',{exact:true}).fill(flag);await page.getByRole('button',{name:'Submit flag',exact:true}).click();await expect(page.getByRole('status')).toContainText('+100 Aura Restored');await expect(page.getByLabel('FLAG CAPTURED')).toBeDisabled();
  await page.getByRole('button',{name:'Close challenge'}).click();await page.getByRole('button',{name:'Sigma Scoreboard'}).click();await expect(page.getByRole('row').filter({hasText:username})).toContainText('100');
});
test('responsive navigation, keyboard dialog dismissal, and honest sandbox-unavailable state',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('button',{name:'Open Ping of Ohio'}).click();await expect(page.getByRole('button',{name:'Let Him Cook'})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
});
test('live Docker: extract a dynamic flag through the intended command injection',async({page})=>{
  test.skip(process.env.LIVE_DOCKER!=='1','Requires running Linux Docker stack and firewall.');
  await page.goto('/');await page.getByRole('button',{name:'Enter the arena'}).click();await page.getByLabel('HANDLE',{exact:true}).fill(`live_${Date.now()}`);await page.getByLabel('PASSWORD',{exact:true}).fill('correct horse battery sigma');await page.getByRole('button',{name:'Create account',exact:true}).click();
  await page.getByRole('button',{name:'Open Ping of Ohio'}).click();await page.getByRole('button',{name:'Let Him Cook'}).click();const link=page.getByRole('link',{name:'Open challenge',exact:true});await expect(link).toBeVisible();
  const url=await link.getAttribute('href');const lab=await page.context().newPage();let body='';
  try { await expect.poll(async()=>{try{await lab.goto(`${url}/?host=${encodeURIComponent('127.0.0.1; printenv FLAG')}`);body=await lab.locator('body').innerText();return /sigma\{[a-f0-9]+\}/.test(body);}catch{return false;}},{timeout:30000}).toBe(true); }
  finally { await lab.close(); }
  const flag=body.match(/sigma\{[a-f0-9]+\}/)![0];await page.getByLabel('CAPTURE THE FLAG',{exact:true}).fill(flag);await page.getByRole('button',{name:'Submit flag',exact:true}).click();await expect(page.getByRole('status')).toContainText('+100 Aura Restored');await page.getByRole('button',{name:'Terminate',exact:true}).click();
});
