// List reads run independently of confirmed writes. Their failure never becomes a save failure.
export function refreshInBackground(refresh,onError=()=>{}) {
 void Promise.resolve().then(refresh).catch(onError);
}
