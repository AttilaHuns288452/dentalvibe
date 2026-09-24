import OwnerManage from './OwnerManage'
import OwnerServicePrices from './OwnerServicePrices'
import OwnerIncome from './OwnerIncome'
import IncomeHub from './IncomeHub'
import OwnerStaff from './OwnerStaff'

// P1: owner pages in one lazy chunk (role-shell split).
const M = { OwnerManage, OwnerServicePrices, OwnerIncome, IncomeHub, OwnerStaff }
export default function OwnerShell({ name, ...props }) {
  const C = M[name]
  return C ? <C {...props} /> : null
}
