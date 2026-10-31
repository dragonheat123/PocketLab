/** A versioned, deterministic benchmark. Only this reviewed script is uploaded to Daytona. */
export function batteryKernel({runId,variant='adaptive',epochs=1000,runtime='daytona-python'}){
  return `import json, math, os, platform, hashlib, time
import torch

CONFIG = ${JSON.stringify({runId,variant,epochs,runtime})}
torch.set_num_threads(1)
torch.manual_seed(7)
STARTED = time.time()
CODE_HASH = hashlib.sha256(open(__file__, "rb").read()).hexdigest()
RUNTIME = {"python":platform.python_version(),"pytorch":torch.__version__,"cuda_available":torch.cuda.is_available(),"execution_device":"cpu","hostname":platform.node()}
prices = torch.tensor([42,36,29,24,22,30,48,76,91,73,54,41,33,28,36,65,102,138,124,91,72,61,53,46], dtype=torch.float64) / 1000
capacity, max_power, initial_soc = 10.0, 3.3, 2.0
eta = math.sqrt(0.90)

print("POCKETLAB_PROVENANCE " + json.dumps({"run_id":CONFIG["runId"],"hostname":platform.node(),"platform":platform.platform(),"pid":os.getpid(),"code_sha256":CODE_HASH}), flush=True)
print("POCKETLAB_RUNTIME " + json.dumps(RUNTIME), flush=True)
print("Battery benchmark v1: 24 hours, 10 kWh, 3.3 kW, 90% round-trip efficiency", flush=True)
print("Prices are a fixed illustrative profile; this is a reproducible optimization benchmark, not a market backtest.", flush=True)

def optimize(strategy):
    raw = torch.zeros(24, dtype=torch.float64, requires_grad=True)
    optimizer = torch.optim.Adam([raw], lr=0.05)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=CONFIG["epochs"]) if strategy == "cosine" else None
    for epoch in range(CONFIG["epochs"]):
        optimizer.zero_grad()
        actions = torch.tanh(raw) * max_power
        changes = torch.where(actions >= 0, actions * eta, actions / eta)
        soc = initial_soc + torch.cumsum(changes, dim=0)
        weight = 0.5 + 19.5 * epoch / max(1,CONFIG["epochs"]-1) if strategy == "adaptive" else 20.0
        penalty = torch.relu(soc-capacity).square().sum() + torch.relu(-soc).square().sum() + (soc[-1]-initial_soc).square()
        loss = (prices*actions).sum() + weight*penalty
        if strategy == "degradation":
            loss = loss + 0.01 * actions.abs().sum()
        loss.backward()
        optimizer.step()
        if scheduler:
            scheduler.step()
        if epoch % 100 == 0 or epoch == CONFIG["epochs"]-1:
            print(json.dumps({"strategy":strategy,"epoch":epoch+1,"epochs":CONFIG["epochs"],"loss":round(loss.item(),7),"raw_constraint_penalty":round(penalty.item(),7)}), flush=True)
    # Replay a feasible schedule with a terminal reserve, using the same physical rules.
    # This projection is reported explicitly and is applied to BOTH compared strategies.
    soc, cost, throughput, schedule = initial_soc, 0.0, 0.0, []
    desired = (torch.tanh(raw.detach())*max_power).tolist()
    for hour, action in enumerate(desired):
        reserve = max(0.0, initial_soc - (23-hour)*max_power*eta)
        low = (reserve-soc)/eta if reserve>soc else (reserve-soc)*eta
        high = (capacity-soc)/eta
        action = max(-max_power, low, min(max_power, high, action))
        soc += action*eta if action>=0 else action/eta
        cost += float(prices[hour])*action
        throughput += abs(action)
        schedule.append({"hour":hour,"action_kw":round(action,6),"soc_kwh":round(soc,6)})
    violations = sum(max(0.0,s["soc_kwh"]-capacity,-s["soc_kwh"],abs(s["action_kw"])-max_power) for s in schedule) + max(0.0,initial_soc-soc)
    return {"profit_usd":-cost,"final_loss":float(loss.detach()),"violations":violations,"final_soc_kwh":soc,"throughput_kwh":throughput,"hourly_schedule":schedule}

print("Running fixed-penalty Adam baseline", flush=True)
baseline = optimize("baseline")
print("Running requested variant: " + CONFIG["variant"], flush=True)
variant = optimize(CONFIG["variant"]) if CONFIG["variant"]!="baseline" else baseline
metrics = {"status":"SUCCESS","run_id":CONFIG["runId"],"code_sha256":CODE_HASH,"variant":CONFIG["variant"],"epochs":CONFIG["epochs"],"profit_usd":variant["profit_usd"],"baseline_profit_usd":baseline["profit_usd"],"delta_usd":variant["profit_usd"]-baseline["profit_usd"],"final_loss":variant["final_loss"],"violations":variant["violations"],"final_soc_kwh":variant["final_soc_kwh"],"execution_time_sec":time.time()-STARTED,"hourly_schedule":variant["hourly_schedule"],"schedule_projection":"Physical bounds and terminal energy reserve applied to baseline and variant","runtime_info":RUNTIME}
print("POCKETLAB_METRICS_START", flush=True)
print(json.dumps(metrics,allow_nan=False), flush=True)
print("POCKETLAB_METRICS_END", flush=True)
`;
}
