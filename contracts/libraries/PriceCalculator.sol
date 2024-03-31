// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

library PriceCalculator {

    /// @dev This help to calculate the rent price.
    /// @param _startingDate Starting timestamp of the rent
    /// @param _endingDate Ending timestamp of the rent
    /// @param _pricePerDay Price per day
    /// @param _isProRated Is the rent pro rated
    function calculateRentPrice(
        uint256 _startingDate,
        uint256 _endingDate,
        uint256 _pricePerDay,
        bool _isProRated
    ) internal view returns (uint256) {
        uint256 timeDifference = 0;
        if (_isProRated) {
            timeDifference = block.timestamp - _startingDate;
        } else {
            // old division by 1000 because solidity use second and JS milliseconds
            timeDifference = _endingDate - _startingDate;
        }
        uint256 secondsPerDay = 24 * 60 * 60;
        // calculate the number of days (rounded up)
        uint256 numberOfDays = (timeDifference + (secondsPerDay - 1)) /
            secondsPerDay;
        return _pricePerDay * numberOfDays;
    }

    /// @dev Calculate the fees for the protocol - 0.3% for the moment.abi
    /// It only return the fees, not the original amount + fees
    /// @param _amount Number on which you want to apply fees
    function calculateFees(uint256 _amount) internal pure returns (uint256) {
        return (_amount * 3) / 997 + 1;
    }
}
