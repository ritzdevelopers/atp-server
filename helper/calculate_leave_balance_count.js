const calculateLeaveBalanceCount = (arr) => {
    if(arr.length === 0) {
        return {
            totalLeaves: 0,
            usedLeaves: 0,
            remainingLeaves: 0
        }
    }
    let totalLeaves = 0;
    let usedLeaves = 0;
    let remainingLeaves = 0;
    arr.forEach((obj)=>{
        totalLeaves += obj.total_leaves;
        usedLeaves += obj.used_leaves;
        remainingLeaves += obj.remaining_leaves;
    });
    return {
        totalLeaves,
        usedLeaves,
        remainingLeaves
    }

}


export default calculateLeaveBalanceCount;