import os
import joblib


class NaiveModel:
    """Reference forecast without learning: predict the value of one lag feature.

    lag_1  -> persistence ("the next 15 minutes look like the last 15 minutes")
    lag_96 -> seasonal naive ("same time yesterday")

    Features arrive standardized, so the lag column is mapped back to kW with the
    training mean and scale.
    """

    def __init__(self, lag_col, feature_names, feature_mean, feature_scale):
        self.lag_col = lag_col
        self.idx = feature_names.index(lag_col)
        self.mean = feature_mean[self.idx]
        self.scale = feature_scale[self.idx]

    def train(self, X, y):
        pass  # nothing to learn

    def predict(self, X):
        return X[:, self.idx] * self.scale + self.mean

    def save(self, path):
        joblib.dump({"lag_col": self.lag_col, "mean": self.mean, "scale": self.scale}, path, compress=3)

    @staticmethod
    def model_size(path):
        if not os.path.exists(path): return 0
        return os.path.getsize(path) / (1024 * 1024)

    def complexity(self):
        return "none"

    def get_hyperparameters(self):
        return {"lag_col": self.lag_col}
