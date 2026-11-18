import platform
import subprocess
import sys

import numpy as np
import psutil
import sklearn
import torch


def _cpu_name():
    # platform.processor() only returns "arm" on Apple Silicon; ask the OS for the real name
    if sys.platform == "darwin":
        try:
            return subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"],
                                  capture_output=True, text=True, check=True).stdout.strip()
        except (OSError, subprocess.CalledProcessError):
            pass
    return platform.processor() or platform.machine()


def get_hardware_profile():
    return {
        "cpu": _cpu_name(),
        "machine": platform.machine(),
        "os": platform.platform(),
        "physical_cores": psutil.cpu_count(logical=False),
        "logical_cores": psutil.cpu_count(logical=True),
        "ram_gb": round(psutil.virtual_memory().total / (1024 ** 3), 2),
        "torch_threads": torch.get_num_threads(),
        "python": platform.python_version(),
        "numpy": np.__version__,
        "scikit_learn": sklearn.__version__,
        "torch": torch.__version__,
    }
